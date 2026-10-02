// src/app/api/auth/signup/route.js
// G-CrowdBang / F-CrowdBang · 邮箱注册网关（App Router Route Handler）
// 职责：由 Vercel 服务端直连 Firebase Identity Toolkit 创建账号（accounts:signUp），
//       并在服务端尽力建立 users / workers 角色账本、写入 gb_session cookie。
// 设计原因：前端浏览器直连 Firebase Auth API 在受限网络下会报
//       auth/network-request-failed；改走服务端代理后由境外 Vercel 服务器代连，
//       彻底绕开该网络问题。真实环境用 API key 调 Identity Toolkit；
//       本地无真实项目时返回 mock 占位令牌便于本地联调。
// 合规：标准邮箱注册，不涉及任何规避逻辑。

import { NextResponse } from "next/server";
import { issueMockToken } from "../../../../database/auth-server";

const IDENTITY_TOOLKIT_SIGNUP = "https://identitytoolkit.googleapis.com/v1/accounts:signUp";

export async function POST(request) {
  try {
    const body = await request.json();
    const { email, password, role = "worker" } = body || {};

    if (!email || !password) {
      return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    }
    if (typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json({ error: "INVALID_EMAIL" }, { status: 400 });
    }
    if (typeof password !== "string" || password.length < 6) {
      return NextResponse.json({ error: "WEAK_PASSWORD" }, { status: 400 });
    }

    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

    // 真实模式：用 API key 直连 Identity Toolkit 创建账号（服务端代理，服务器在境外可连通）
    if (apiKey && !String(apiKey).includes("your_")) {
      const res = await fetch(
        `${IDENTITY_TOOLKIT_SIGNUP}?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, returnSecureToken: true }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        return NextResponse.json(
          { error: data.error?.message || `HTTP_${res.status}`, reason: data.error?.message },
          { status: 400 }
        );
      }

      // 尽力而为：若服务端配了 Firebase Admin 服务账号，为角色建立 users / workers 账本
      try {
        const { getFirestore } = await import("firebase-admin/firestore");
        const { getApps, initializeApp, cert } = await import("firebase-admin/app");
        const projectId = process.env.FIREBASE_PROJECT_ID;
        const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
        const privateKey = process.env.FIREBASE_PRIVATE_KEY;
        if (
          projectId &&
          clientEmail &&
          privateKey &&
          !String(privateKey).includes("TEST_ONLY_PLACEHOLDER")
        ) {
          if (!getApps().length) {
            initializeApp({
              credential: cert({
                projectId,
                clientEmail,
                privateKey: privateKey.replace(/\\n/g, "\n"),
              }),
            });
          }
          const db = getFirestore();
          const uid = data.localId;
          await db.collection("users").doc(uid).set({
            uid,
            email: data.email,
            role: String(role).toLowerCase(),
            balance_usd: 0.0,
            created_at: new Date().toISOString(),
          });
          if (String(role).toLowerCase() === "worker") {
            await db.collection("workers").doc(uid).set({ balance: 0.0 });
          }
        }
      } catch (e) {
        console.warn("[auth/signup] role ledger skipped:", e?.message);
      }

      const signupRes = NextResponse.json(
        {
          idToken: data.idToken,
          uid: data.localId,
          email: data.email,
          role: String(role).toLowerCase(),
          tokenType: "firebase",
        },
        { status: 200 }
      );
      signupRes.cookies.set("gb_session", data.idToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 5,
      });
      return signupRes;
    }

    // 本地 mock：返回确定性占位令牌（仅供本地联调）
    const uid = `uid_${email.split("@")[0]}`;
    const mockToken = issueMockToken(uid, role);
    const mockRes = NextResponse.json(
      { idToken: mockToken, uid, email, role: String(role).toLowerCase(), tokenType: "mock" },
      { status: 200 }
    );
    mockRes.cookies.set("gb_session", mockToken, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 5,
    });
    return mockRes;
  } catch (err) {
    console.error("[auth/signup]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
