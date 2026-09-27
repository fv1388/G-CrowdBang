// src/app/api/auth/login/route.js
// G-CrowdBang / F-CrowdBang · 邮箱/密码登录网关（App Router Route Handler）
// 职责：接收邮箱+密码，走标准 Firebase Identity Toolkit (signInWithPassword) 换取
//       ID Token，供后续请求通过 Authorization: Bearer <idToken> 携带（UID 烙印）。
// 兼容策略：真实环境用 NEXT_PUBLIC_FIREBASE_API_KEY 调 Firebase 身份工具包；
//           本地无真实项目时返回确定性 mock 占位令牌，便于本地联调。
// 合规：标准密码登录，不涉及任何规避逻辑。

import { NextResponse } from "next/server";
import { issueMockToken, isAuthReady } from "../../../../database/auth";

const IDENTITY_TOOLKIT = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword";

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

    // 真实 Admin Auth 就绪：用 Firebase Identity Toolkit 换 ID Token
    if (isAuthReady() && process.env.NEXT_PUBLIC_FIREBASE_API_KEY) {
      const res = await fetch(
        `${IDENTITY_TOOLKIT}?key=${encodeURIComponent(process.env.NEXT_PUBLIC_FIREBASE_API_KEY)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            returnSecureToken: true,
          }),
        }
      );

      const data = await res.json();
      if (!res.ok) {
        return NextResponse.json(
          { error: "INVALID_CREDENTIALS", reason: data.error?.message || `HTTP_${res.status}` },
          { status: 401 }
        );
      }

      return NextResponse.json(
        {
          idToken: data.idToken,
          uid: data.localId,
          email: data.email,
          role,
          tokenType: "firebase",
        },
        { status: 200 }
      );
    }

    // 本地 mock：返回确定性占位令牌（仅供本地联调，非真实认证）
    const uid = `uid_${email.split("@")[0]}`;
    return NextResponse.json(
      {
        idToken: issueMockToken(uid, role),
        uid,
        email,
        role,
        tokenType: "mock",
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[auth/login]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
