// src/app/api/auth/me/route.js
// G-CrowdBang / F-CrowdBang · 当前身份校验接口（App Router Route Handler）
// 职责：读取请求 Headers 的 `Authorization: Bearer <idToken>`，校验令牌，
//       返回当前登录用户的 uid / role / email（UID 烙印端到端验证）。

import { NextResponse } from "next/server";
import { requireAuth } from "../../../../database/auth";

export async function GET(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error === "FORBIDDEN" ? "FORBIDDEN" : "UNAUTHORIZED" },
      { status: auth.error === "FORBIDDEN" ? 403 : 401 }
    );
  }

  return NextResponse.json(
    { uid: auth.uid, role: auth.role, email: auth.email ?? null, tokenType: auth.tokenType },
    { status: 200 }
  );
}
