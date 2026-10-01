// src/database/auth.js
// G-CrowdBang / F-CrowdBang · 用户/商户登录基本鉴权中心（服务端）
// 职责：初始化 Firebase Admin Auth，提供统一的登录令牌(UID)校验与角色烙印工具，
//       供后续所有受保护 API 在 Headers 里校验 `Authorization: Bearer <idToken>`。
// 兼容策略：真实环境用 admin.auth().verifyIdToken 校验 Firebase ID Token；
//           本地 mock（无真实服务账号凭证）解码 `mock.<uid>.<role>` 占位令牌，便于本地联调。
// 合规：标准邮箱/密码登录网关与令牌校验，不涉及任何规避逻辑。

import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { NextResponse } from "next/server";

// ---- 单一实例初始化（幂等）----
let authInstance = null;
let adminReady = false;

function ensureAdminAuth() {
  if (authInstance) return authInstance;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  // 凭证守卫：占位/缺失时进入 mock 模式（不做真实校验，只解码本地占位令牌）
  const realCreds =
    projectId &&
    projectId !== "f-crowdbang-test" &&
    clientEmail &&
    privateKey &&
    !String(privateKey).includes("TEST_ONLY_PLACEHOLDER");

  if (!realCreds) {
    adminReady = false;
    authInstance = null;
    return null;
  }

  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, "\n"),
      }),
    });
  }
  authInstance = getAuth();
  adminReady = true;
  return authInstance;
}

// ---- 从请求 Headers 提取 Bearer 令牌 ----
// P0 对接修复：页面 fetch 普遍不带 Authorization 头，兜底读取 gb_session cookie
// （cookie 里存的就是登录网关落下的 idToken / mock 令牌，语义一致）
export function extractBearerToken(request) {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (match) return match[1].trim();
  try {
    const cookieToken = request.cookies?.get?.("gb_session")?.value;
    if (cookieToken) return cookieToken;
  } catch {
    /* 非 NextRequest 场景静默忽略 */
  }
  return null;
}

// ---- 真实模式角色对账：idToken 通常无 role claim，回查 users 账本 ----
async function lookupUserRole(uid) {
  try {
    const { getFirestore } = await import("firebase-admin/firestore");
    const snap = await getFirestore().collection("users").doc(uid).get();
    if (snap.exists) return snap.data().role || null;
  } catch (e) {
    console.warn("[auth-server] role lookup failed:", e?.message);
  }
  return null;
}

// ---- 令牌校验：真实 admin 校验 或 本地 mock 解码 ----
// 返回 { ok, uid, role, email, tokenType }
export async function verifyToken(token) {
  if (!token) return { ok: false, error: "NO_TOKEN" };

  const admin = ensureAdminAuth();
  if (admin && adminReady) {
    try {
      const decoded = await admin.verifyIdToken(token);
      let role = decoded.role || decoded.role_from_claim || null;
      if (!role) {
        // idToken 无角色烙印 → 回查 users 多租户账本（requireAuthWithRole 依赖此处）
        role = (await lookupUserRole(decoded.uid)) || "worker";
      }
      return {
        ok: true,
        uid: decoded.uid,
        role,
        email: decoded.email || null,
        tokenType: "firebase",
      };
    } catch (e) {
      return { ok: false, error: "INVALID_TOKEN", detail: e.code || e.message };
    }
  }

  // 本地 mock 解码：`mock.<uid>.<role>` 占位令牌（仅供本地联调）
  if (token.startsWith("mock.")) {
    const parts = token.split(".");
    if (parts.length >= 2) {
      return {
        ok: true,
        uid: parts[1],
        role: parts[2] || "worker",
        email: null,
        tokenType: "mock",
      };
    }
  }
  return { ok: false, error: "INVALID_TOKEN" };
}

// ---- 请求鉴权封装：读取 Header 令牌并校验 ----
// 返回 { ok, uid, role, error }，调用方据此放行或返回 401。
export async function requireAuth(request, { allowedRoles } = {}) {
  const token = extractBearerToken(request);
  if (!token) return { ok: false, error: "UNAUTHORIZED" };

  const result = await verifyToken(token);
  if (!result.ok) return { ok: false, error: result.error || "UNAUTHORIZED" };

  if (allowedRoles && allowedRoles.length && !allowedRoles.includes(result.role)) {
    return { ok: false, error: "FORBIDDEN", role: result.role };
  }

  return result; // { ok, uid, role, email }
}

// ---- 角色归一化：统一转大写，兼容 "worker"/"WORKER"/"merchant"/"MERCHANT" ----
export function normalizeRole(role) {
  return String(role || "").toUpperCase();
}

// ---- 组合鉴权：校验 token + 角色，直接返回 NextResponse 错误 ----
// 用法：
//   const auth = await requireAuthWithRole(request, "MERCHANT");
//   if (auth.error) return auth.error;
//   const uid = auth.uid;
export async function requireAuthWithRole(request, allowedRole) {
  const token = extractBearerToken(request);
  if (!token) {
    return { error: NextResponse.json({ error: "UNAUTHORIZED", hint: "missing bearer token" }, { status: 401 }) };
  }
  const result = await verifyToken(token);
  if (!result.ok) {
    return { error: NextResponse.json({ error: result.error || "UNAUTHORIZED" }, { status: 401 }) };
  }
  if (allowedRole && normalizeRole(result.role) !== normalizeRole(allowedRole)) {
    return {
      error: NextResponse.json(
        { error: "FORBIDDEN", expected: allowedRole, actual: result.role },
        { status: 403 }
      ),
    };
  }
  return { uid: result.uid, role: normalizeRole(result.role), email: result.email, tokenType: result.tokenType };
}

// ---- 是否可用真实 Admin Auth（供调用方决定走真实还是 mock）----
export function isAuthReady() {
  ensureAdminAuth();
  return adminReady;
}

// ---- 生成本地 mock 占位令牌（仅登录网关在无真实 Firebase 项目时返回，供本地联调）----
export function issueMockToken(uid, role = "worker") {
  return `mock.${uid}.${role}`;
}
