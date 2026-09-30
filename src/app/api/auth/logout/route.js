// src/app/api/auth/logout/route.js
// P0 修复：登出时清除 gb_session cookie，防止残留会话被 middleware 误判为已登录
import { NextResponse } from "next/server";

export async function POST() {
  const res = NextResponse.json({ ok: true }, { status: 200 });
  res.cookies.set("gb_session", "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  return res;
}
