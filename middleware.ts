// middleware.ts (Next.js 根目录中间件)
// ==========================================================================
// G-CrowdBang · P0 权限修复
// 职责：
//   1. 保留原 src/proxy.ts 的路径重写：/tasks/* -> /shop/tasks/*
//   2. 登录态守卫：未带 gb_session cookie 访问 /admin/* 或 /shop/tasks/*
//      一律 307 重定向到 /auth?next=<原路径>，杜绝游客直接渲染后台页面。
//   3. /api/* 请求不做 307（API 用 401 JSON 响应），真实鉴权在各路由用 requireAuth。
// 注意：middleware 跑在 Edge Runtime，不能用 firebase-admin；这里只做 cookie 粗筛，
//       真正的 token 校验（verifyIdToken）在 API Route 里做。
// ==========================================================================

import { NextRequest, NextResponse } from "next/server";

const TASK_PREFIX = "/tasks";
const TASK_HALL = "/shop/tasks";

// 需要登录才能看的页面前缀（商户后台 + Worker 任务大厅）
const PROTECTED_PAGE_PREFIXES = ["/admin", "/shop/tasks"];

function resolveRewriteTarget(pathname: string): string | null {
  if (pathname === TASK_PREFIX || pathname.startsWith(`${TASK_PREFIX}/`)) {
    return TASK_HALL + pathname.slice(TASK_PREFIX.length);
  }
  return null;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1) 路径重写（保留原 proxy 行为）
  const target = resolveRewriteTarget(pathname);
  const finalPath = target ? target : pathname;

  // 2) 登录态守卫：只拦页面，不拦 API
  const isPageRoute = !finalPath.startsWith("/api/");
  const isProtected = PROTECTED_PAGE_PREFIXES.some(
    (p) => finalPath === p || finalPath.startsWith(`${p}/`)
  );

  if (isPageRoute && isProtected) {
    const sessionCookie = request.cookies.get("gb_session")?.value;
    if (!sessionCookie) {
      const loginUrl = new URL("/auth", request.url);
      loginUrl.searchParams.set("next", finalPath);
      return NextResponse.redirect(loginUrl, 307);
    }
  }

  // 3) 应用重写或放行
  if (target) {
    return NextResponse.rewrite(new URL(target, request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/tasks/:path*",
    "/shop/tasks/:path*",
    // API 也需要匹配，以便将来在 middleware 里统一加安全头；鉴权仍由各 route 负责
    "/api/admin/:path*",
    "/api/merchant/:path*",
    "/api/workers/:path*",
    "/api/payouts/:path*",
    "/api/tasks/:path*",
    "/api/campaigns/:path*",
  ],
};
