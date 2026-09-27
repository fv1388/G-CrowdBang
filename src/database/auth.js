// src/database/auth.js
// G-CrowdBang / F-CrowdBang · 客户端账户鉴权初始化中心（React + Firebase Auth Client SDK）
// 职责：标准 Firebase 邮箱注册/登录封装 + AuthStateListener 状态监听 Hook。
//       登录成功后安全获取 F-CrowdBang 分配的唯一 UID（即数据隔离墙所需的 merchantId/workerId），
//       并通过账户类型(Merchant/Worker)向下游页面暴露。
// 兼容策略：配置真实 NEXT_PUBLIC_FIREBASE_* 时走标准 firebase/auth；本地无真实项目时
//           用确定性 mock 会话兜底（localStorage），保证本地联调不崩。
// 合规：标准邮箱/密码登入与状态监听，不涉及任何规避逻辑。

"use client";

import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
} from "firebase/auth";
import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// 1. Firebase App / Auth 单例初始化（幂等）
// ---------------------------------------------------------------------------

// 判定是否配置了"真实可用的" Firebase 公共句柄（非占位）
function firebaseConfigReady() {
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

// 获取 Auth 单例（惰性）
function getAuthInstance() {
  return getAuth(getAppInstance());
}

// 本地 mock 会话的存取键（无真实 Firebase 项目时用于本地联调）
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

// 从 Firebase User 提取标准化会话对象（UID 烙印 + 账户类型）
async function extractSession(user) {
  // 读取 custom claims 中的 role（F-CrowdBang 数据隔离墙按 request.auth.token.role 判权）
  let role = "worker";
  try {
    const idTokenResult = await user.getIdTokenResult();
    role = idTokenResult.claims?.role || "worker";
  } catch {
    /* 兜底 worker */
  }
  return { uid: user.uid, role, email: user.email ?? null };
}

// ---------------------------------------------------------------------------
// 2. 标准账户登入 / 注册封装
// ---------------------------------------------------------------------------

// 邮箱注册：返回 { uid, role, email }
export async function signUpWithEmail(email, password, role = "worker") {
  if (!firebaseConfigReady()) {
    // 本地 mock：写入确定性会话，供本地联调（非真实注册）
    const uid = `uid_${email.split("@")[0]}`;
    const session = { uid, role, email, tokenType: "mock" };
    writeMockSession(session);
    return session;
  }

  const userCredential = await createUserWithEmailAndPassword(
    getAuthInstance(),
    email,
    password
  );
  return extractSession(userCredential.user);
}

// 邮箱登录：返回 { uid, role, email }
export async function signInWithEmail(email, password) {
  if (!firebaseConfigReady()) {
    // 本地 mock：与 signUp 一致的确定性会话
    const uid = `uid_${email.split("@")[0]}`;
    const session = { uid, role: "worker", email, tokenType: "mock" };
    writeMockSession(session);
    return session;
  }

  const userCredential = await signInWithEmailAndPassword(
    getAuthInstance(),
    email,
    password
  );
  return extractSession(userCredential.user);
}

// 登出（可选扩展）
export async function signOut() {
  if (firebaseConfigReady()) {
    await getAuthInstance().signOut();
  } else {
    clearMockSession();
  }
}

// ---------------------------------------------------------------------------
// 3. 标准 AuthStateListener 状态监听 Hook
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

    if (!firebaseConfigReady()) {
      // 本地 mock：读取确定性会话
      setSession(readMockSession());
      setLoading(false);
      return;
    }

    const auth = getAuthInstance();
    unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const s = await extractSession(user);
        setSession(s);
      } else {
        setSession(null);
      }
      setLoading(false);
    });

    return () => {
      if (unsub) unsub();
    };
  }, []);

  return { session, loading };
}
