// src/app/api/auth/session/route.js
// G-CrowdBang · 会话落地端点（P0 对接修复）
// 职责：客户端 SDK 登录成功后（邮箱或 Google），前端把拿到的 Firebase idToken
//       POST 到这里，服务端校验通过即写下 gb_session cookie，
//       供 middleware 放行 /admin、/shop/tasks 等受保护页面。
// 兼容策略：真实环境 verifyIdToken 校验；本地 mock 令牌（mock.<uid>.<role>）同样放行。
import { NextResponse } from "next/server";
import { verifyToken } from "../../../../database/auth-server";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const idToken = body?.idToken;
    if (!idToken || typeof idToken !== "string") {
      return NextResponse.json({ error: "MISSING_TOKEN" }, { status: 400 });
    }

    const result = await verifyToken(idToken);
    if (!result.ok) {
      return NextResponse.json({ error: result.error || "INVALID_TOKEN" }, { status: 401 });
    }

    const res = NextResponse.json(
      {
        ok: true,
        uid: result.uid,
        role: result.role,
        email: result.email ?? null,
        tokenType: result.tokenType,
      },
      { status: 200 }
    );
    res.cookies.set("gb_session", idToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 5,
    });
    return res;
  } catch (err) {
    console.error("[auth/session]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
