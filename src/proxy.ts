import { NextRequest, NextResponse } from "next/server";

/**
 * G-CrowdBang — Next.js 16 根代理（原 middleware，统一收口到 proxy.ts）。
 *
 * Responsibilities:
 *  1. Path routing: `/tasks`, `/tasks/...` -> internal rewrite to `/shop/tasks[/...]`
 *     (URL bar keeps the original path; sub-paths preserved).
 *  2. Auth guard (P0): page requests to `/admin`, `/shop/tasks` without the
 *     `gb_session` cookie are 307-redirected to `/auth?next=<path>`, so guests
 *     can never render the back-office or the task hall.
 *  3. `/api/*` requests are never redirected (APIs answer with 401 JSON via
 *     requireAuth in each route handler).
 *
 * Note: this runs on the Edge Runtime — no firebase-admin here. Real token
 * verification happens in the API routes.
 */

const TASK_PREFIX = "/tasks";
const TASK_HALL = "/shop/tasks";

// 需要登录才能看的页面前缀（商户后台 + Worker 任务大厅）
const PROTECTED_PAGE_PREFIXES = ["/admin", "/shop/tasks"];

/**
 * Resolve the internal rewrite target for a given pathname.
 * Returns `null` when the request should pass through untouched.
 *
 * - `/admin` and `/admin/*`       -> null (native route, preserve sub-paths)
 * - `/shop/tasks` and `/shop/tasks/*` -> null (native route, preserve sub-paths)
 * - `/tasks`                      -> `/shop/tasks`
 * - `/tasks/*`                    -> `/shop/tasks/*` (sub-path preserved)
 */
function resolveRewriteTarget(pathname: string): string | null {
  if (pathname === TASK_PREFIX || pathname.startsWith(`${TASK_PREFIX}/`)) {
    return TASK_HALL + pathname.slice(TASK_PREFIX.length);
  }
  return null;
}

export function proxy(request: NextRequest) {
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
  // Only intercept the paths this proxy is responsible for.
  // `/` itself is intentionally NOT matched, so the storefront homepage is
  // never touched by any rewrite.
  matcher: [
    "/admin/:path*",
    "/tasks/:path*",
    "/shop/tasks/:path*",
    // API 也需要匹配，以便将来统一加安全头；鉴权仍由各 route 负责
    "/api/admin/:path*",
    "/api/merchant/:path*",
    "/api/workers/:path*",
    "/api/payouts/:path*",
    "/api/tasks/:path*",
    "/api/campaigns/:path*",
  ],
};
