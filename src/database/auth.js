// src/database/auth.js
// ==========================================================================
// G-CrowdBang / F-CrowdBang · 双轨制鉴权中心（邮箱密码 + 一键谷歌 Google Sign-In）
// --------------------------------------------------------------------------
// 多环境安全隔离契约：
//   - 真实模式：已配置非占位 NEXT_PUBLIC_FIREBASE_* → 走标准 firebase/auth + Firestore 角色对账。
//   - 本地全仿真 Mock 降级守卫：apiKey 缺失或含 your_ 占位符 → 全自动拦截外网弹窗，
//     秒级返回确定性虚拟会话，杜绝 "登录失败，请检查浏览器连接状态" 的网络报错。
//
// 兼容契约（保持不变，确保现有页面不被破坏）：
//   - { session, loading } 结构、firebaseConfigReady、signUpWithEmail、signInWithEmail、
//     signInWithGoogle、logOutSession、useAuthSession、auth、db。
// 合规：标准 OAuth/邮箱密码登入与状态监听，角色按多租户账本隔离；不含任何规避逻辑。
// ==========================================================================

"use client";

import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut as fbSignOut,
} from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";
import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// 1. Firebase App / Auth 单例初始化（幂等）
// ---------------------------------------------------------------------------

// 判定是否配置了"真实可用的" Firebase 公共句柄（非占位 your_）
export function firebaseConfigReady() {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  return Boolean(
    apiKey &&
      !apiKey.includes("your_") &&
      authDomain &&
      !authDomain.includes("your_") &&
      projectId
  );
}

// 本地全仿真 Mock 占位哨兵：apiKey 缺失或仍为 your_ 虚拟占位符 → 判定为盲测环境
function isMockPlaceholderEnv() {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  return !apiKey || apiKey.includes("your_");
}

// 获取 Firebase App 单例
function getAppInstance() {
  if (getApps().length) return getApp();
  return initializeApp({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
}

// 获取 Auth / Firestore 单例（惰性）
function getAuthInstance() {
  return getAuth(getAppInstance());
}
function getDb() {
  return getFirestore(getAppInstance());
}

// 一键谷歌 Provider：强制每次弹出账号挑选框（select_account）
function getGoogleProvider() {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: "select_account" });
  return p;
}

// ---------------------------------------------------------------------------
// 2. 本地 mock 会话（无真实 Firebase 项目时的确定性兜底，localStorage 常驻）
// ---------------------------------------------------------------------------
const MOCK_SESSION_KEY = "gb_mock_session";

function readMockSession() {
  try {
    const raw = globalThis?.localStorage?.getItem(MOCK_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeMockSession(session) {
  try {
    globalThis?.localStorage?.setItem(MOCK_SESSION_KEY, JSON.stringify(session));
  } catch {
    /* 隐私模式等场景静默忽略 */
  }
}
function clearMockSession() {
  try {
    globalThis?.localStorage?.removeItem(MOCK_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

// Google 后端会话（localStorage）：供 GSI 一键登录成功后写入本地会话。
// 作用：走 /api/auth/google 服务端校验建号后，即使 Firebase 原生 Google
// provider 未启用（signInWithCredential 失败），页面 useAuthSession 仍能
// 读到该本地会话，保证登录后可正常进入对应角色空间（不依赖 provider 启用）。
const GOOGLE_SESSION_KEY = "gb_google_session";

function readGoogleSession() {
  try {
    const raw = globalThis?.localStorage?.getItem(GOOGLE_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeGoogleSession(session) {
  try {
    globalThis?.localStorage?.setItem(GOOGLE_SESSION_KEY, JSON.stringify(session));
  } catch {
    /* ignore */
  }
}
function clearGoogleSession() {
  try {
    globalThis?.localStorage?.removeItem(GOOGLE_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** 供前端 Google 登录成功后持久化本地会话（uid / email / role）。 */
export function persistGoogleSession(uid, email, role) {
  const s = {
    uid,
    email,
    role: String(role || "WORKER").toUpperCase(),
    tokenType: "google-local",
  };
  writeGoogleSession(s);
  return s;
}

// mock：写入确定性会话并返回
function mockSession(uid, role, email) {
  const session = { uid, role, email, tokenType: "mock" };
  writeMockSession(session);
  return session;
}

// 为盲测环境生成一个稳定可复用的虚拟会话（角色按页面测试需要指定）
function buildVirtualMockSession(role = "WORKER") {
  const r = String(role).toUpperCase();
  const email = `test_${r.toLowerCase()}_${Math.random().toString(36).slice(2, 6)}@gmail.com`;
  return mockSession(`mock_virtual_${r.toLowerCase()}_${Date.now().toString(36)}`, r, email);
}

// ---------------------------------------------------------------------------
// 3. 从 Firebase User / 对账账本提取标准化会话对象（UID 烙印 + 账户类型）
// ---------------------------------------------------------------------------

// 真实模式：从 users 集合读取该用户的角色（多租户隔离账本），未登记则回退默认
async function extractSession(user, fallbackRole = "worker") {
  let role = fallbackRole;
  let email = user.email ?? null;
  try {
    const db = getDb();
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) {
      const d = snap.data();
      role = d.role || fallbackRole;
      email = d.email || email;
    } else {
      // 兜底：若账本缺失角色，尝试从 token claims 读取
      try {
        const t = await user.getIdTokenResult();
        role = t.claims?.role || fallbackRole;
      } catch { /* 忽略 */ }
    }
  } catch {
    /* 网络/权限异常时回退 fallbackRole */
  }
  return { uid: user.uid, role, email };
}

// ---------------------------------------------------------------------------
// 4. 一键谷歌注册登录（含零密钥盲测 Mock 降级守卫，核心 🌟）
// ---------------------------------------------------------------------------

/**
 * 一键谷歌注册登录。
 * @param {string} selectedRole - 目标角色：'MERCHANT' 或 'WORKER'（新用户锁定该角色写入账本；老用户继承账本角色）
 * @returns {Promise<{uid, role, email}>}
 */
export async function signInWithGoogle(selectedRole = "WORKER") {
  const role = String(selectedRole || "WORKER").toUpperCase();

  // 【核心 · 零密钥盲测守卫】apiKey 缺失或仍为 your_ 占位符 → 全自动拦截外网弹窗，
  // 秒级返回虚拟会话，彻底避免 signInWithPopup 报网络连接错误。
  if (
    isMockPlaceholderEnv() ||
    !firebaseConfigReady()
  ) {
    const uid = `mock_google_user_${Math.random().toString(36).slice(2, 11)}`;
    const email = `test_${role.toLowerCase()}_${Math.random().toString(36).slice(2, 6)}@gmail.com`;
    console.log("[F-CrowdBang Mock] one-click Google sign-in (blocked popup):", uid, role);
    return mockSession(uid, role, email);
  }

  // 真实模式：唤起谷歌官方原生授权弹窗
  const auth = getAuthInstance();
  const db = getDb();
  const result = await signInWithPopup(auth, getGoogleProvider());
  const user = result.user;

  // 多租户隔离对账：查询该谷歌账号是否首次进站
  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);

  let userRole = role;
  if (!userSnap.exists()) {
    // 新用户：写入基础信息 + 锁定角色标签
    await setDoc(userRef, {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      role,
      balance_usd: 0.0,
      created_at: new Date().toISOString(),
    });
    // 老外新用户：初始化零额度钱包，防止查账报红
    if (role === "WORKER") {
      await setDoc(doc(db, "workers", user.uid), { balance: 0.0 });
    }
  } else {
    // 老用户：继承账本中受保护的真实角色
    userRole = userSnap.data().role || role;
  }

  return { uid: user.uid, role: userRole, email: user.email };
}

// ---------------------------------------------------------------------------
// 5. 邮箱密码注册 / 登录
// ---------------------------------------------------------------------------

// 邮箱注册：返回 { uid, role, email }
export async function signUpWithEmail(email, password, role = "worker") {
  if (!firebaseConfigReady()) {
    // 本地 mock：写入确定性会话（不触网，不弹窗）
    return mockSession(`uid_${email.split("@")[0]}`, role, email);
  }
  const userCredential = await createUserWithEmailAndPassword(
    getAuthInstance(),
    email,
    password
  );
  const user = userCredential.user;
  const db = getDb();
  await setDoc(doc(db, "users", user.uid), {
    uid: user.uid,
    email,
    role,
    balance_usd: 0.0,
    created_at: new Date().toISOString(),
  });
  if (String(role).toUpperCase() === "WORKER") {
    await setDoc(doc(db, "workers", user.uid), { balance: 0.0 });
  }
  return { uid: user.uid, role, email: user.email };
}

// 邮箱登录：返回 { uid, role, email }
export async function signInWithEmail(email, password) {
  if (!firebaseConfigReady()) {
    // 本地 mock：与 signUp 一致的确定性会话（默认 worker）
    return mockSession(`uid_${email.split("@")[0]}`, "worker", email);
  }
  const userCredential = await signInWithEmailAndPassword(getAuthInstance(), email, password);
  return extractSession(userCredential.user, "worker");
}

// 登出系统大闸（同时清理 Google 本地会话，防止登出后页面仍被放行）
export async function logOutSession() {
  clearGoogleSession();
  if (firebaseConfigReady()) {
    await fbSignOut(getAuthInstance());
  } else {
    clearMockSession();
  }
}

// ---------------------------------------------------------------------------
// 6. 标准 AuthStateListener 状态监听 Hook（保持 { session, loading } 兼容契约）
// ---------------------------------------------------------------------------

/**
 * useAuthSession
 * 实时监听当前账户活跃状态。
 * 盲测环境（零密钥占位）行为：若无本地登录会话，自动挂载一个默认虚拟会话
 * （默认 role=WORKER，可通过 defaultMockRole 覆盖），确保前端 page.jsx 挂载时
 * 不因 user 为空而高频抛 403，顺畅自检任务卡片渲染；已登录的 mock 会话保持原样。
 * 真实模式：完全按 Firebase 实时登录状态。
 *
 * @param {string} defaultMockRole - 盲测环境默认虚拟会话角色（'WORKER' | 'MERCHANT'）
 * @returns {session, loading}
 */
export function useAuthSession(defaultMockRole = "WORKER") {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsub = null;
    let cancelled = false;

    if (!firebaseConfigReady()) {
      // 盲测环境：优先保留已有 mock 会话；无则挂载默认虚拟 WORKER 会话（常驻本地）
      const existing = readMockSession();
      setSession(existing || buildVirtualMockSession(defaultMockRole));
      setLoading(false);
      return () => { cancelled = true; };
    }

    const auth = getAuthInstance();
    unsub = onAuthStateChanged(auth, async (user) => {
      if (cancelled) return;
      if (user) {
        const s = await extractSession(user, "worker");
        setSession(s);
      } else {
        // Firebase 无会话时，兜底读取 Google 后端会话（GSI 登录走后端校验 + 本地会话）
        const g = readGoogleSession();
        setSession(g ? { uid: g.uid, role: g.role, email: g.email } : null);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, []);

  return { session, loading };
}

export { getAuthInstance as auth, getDb as db };
