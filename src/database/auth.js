// src/database/auth.js
// G-CrowdBang / F-CrowdBang · 双轨制鉴权中心（邮箱密码 + 一键谷歌 Google Sign-In）
// 兼容契约：保留现有 { session, loading } 结构、signUpWithEmail/signInWithEmail/firebaseConfigReady，
//           确保已有页面（admin / shop/tasks / login / DemoLoginCard）不被破坏。
// 新增能力：signInWithGoogle(selectedRole) 一键谷歌注册登录、logOutSession 登出。
// 兼容策略：未配置真实 NEXT_PUBLIC_FIREBASE_* 时走确定性 mock 会话（localStorage），本地联调不崩、
//           不弹外网授权窗；配置真实句柄后走标准 firebase/auth + Firestore 角色对账。
// 合规：标准 OAuth/邮箱密码登入与状态监听，角色按多租户账本隔离；不含任何规避逻辑。

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

// 判定是否配置了"真实可用的" Firebase 公共句柄（非占位）
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
// 2. 本地 mock 会话（无真实 Firebase 项目时的确定性兜底）
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

// mock：写入确定性会话
function mockSession(uid, role, email) {
  const session = { uid, role, email, tokenType: "mock" };
  writeMockSession(session);
  return session;
}

// ---------------------------------------------------------------------------
// 4. 一键谷歌注册登录（双轨制核心）
// ---------------------------------------------------------------------------

/**
 * 一键谷歌注册登录。
 * @param {string} selectedRole - 目标角色：'MERCHANT' 或 'WORKER'（新用户锁定该角色写入账本；老用户继承账本角色）
 * @returns {Promise<{uid, role, email}>}
 */
export async function signInWithGoogle(selectedRole = "WORKER") {
  const role = String(selectedRole || "WORKER").toUpperCase();

  if (!firebaseConfigReady()) {
    // 本地 mock：不触发外网弹窗，分配确定性测试 UID + 角色
    const uid = `mock_google_user_${Math.random().toString(36).slice(2, 11)}`;
    const email = `mock.google.${uid.slice(17)}@example.com`;
    console.log("[F-CrowdBang Mock] one-click Google sign-in:", uid, role);
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
    // 本地 mock：写入确定性会话
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

// 登出系统大闸
export async function logOutSession() {
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
 * 返回：{ session, loading }
 *  - session: 登录时为 { uid, role, email }，未登录为 null（用于身份访问卡点）。
 *  - loading: 初始监听中为 true。
 */
export function useAuthSession() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsub = null;
    let cancelled = false;

    if (!firebaseConfigReady()) {
      // 本地 mock：读取确定性会话
      setSession(readMockSession());
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
        setSession(null);
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
