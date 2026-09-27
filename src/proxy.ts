import { NextRequest, NextResponse } from "next/server";

/**
 * G-CrowdBang — multi-tenant path-based routing middleware (Next.js App Router).
 *
 * Responsibilities (path routing only, no logic beyond route dispatch):
 *  1. `/admin`, `/admin/...`       -> domestic-merchant admin console section
 *     (rewards / bounty publishing space). No third-party ads are injected
 *     into this section by design.
 *  2. `/tasks`, `/shop/tasks`      -> overseas task hall section
 *     (users register, claim tasks, and go through a GPS hardware
 *     anti-fraud verification step on their device).
 *  3. `/` (root, no tenant prefix) -> pass through unchanged (NextResponse.next()).
 *
 * The middleware performs an INTERNAL REWRITE via `NextResponse.rewrite(...)`.
 * The URL bar keeps the original path, while the router renders the target
 * app section on the server. Routing is deterministic and fast (pure string
 * prefix checks, executed before any page render).
 */

const ADMIN_PREFIX = "/admin";
const TASK_PATHS = ["/tasks", "/shop/tasks"];

/**
 * Resolve the internal rewrite target for a given pathname.
 * Returns `null` when the request should pass through untouched.
 */
function resolveRewriteTarget(pathname: string): string | null {
  if (pathname === ADMIN_PREFIX || pathname.startsWith(`${ADMIN_PREFIX}/`)) {
    // Internal rewrite to the admin console section.
    return ADMIN_PREFIX;
  }

  if (
    pathname === TASK_PATHS[0] ||
    pathname.startsWith(`${TASK_PATHS[0]}/`) ||
    pathname === TASK_PATHS[1] ||
    pathname.startsWith(`${TASK_PATHS[1]}/`)
  ) {
    // Internal rewrite to the overseas task hall section.
    return TASK_PATHS[1];
  }

  // Root path `/` (and everything else without a tenant prefix) passes through.
  return null;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1) Admin console section (clean, no third-party ad injection).
  if (pathname === ADMIN_PREFIX || pathname.startsWith(`${ADMIN_PREFIX}/`)) {
    return NextResponse.rewrite(new URL(ADMIN_PREFIX, request.url));
  }

  // 2) Overseas task hall section (both /tasks and /shop/tasks).
  if (
    pathname === TASK_PATHS[0] ||
    pathname.startsWith(`${TASK_PATHS[0]}/`) ||
    pathname === TASK_PATHS[1] ||
    pathname.startsWith(`${TASK_PATHS[1]}/`)
  ) {
    return NextResponse.rewrite(new URL(TASK_PATHS[1], request.url));
  }

  // 3) Root path and any other path: green-light pass through.
  return NextResponse.next();
}

export const config = {
  // Only intercept the paths this middleware is responsible for.
  // `/` itself is intentionally NOT matched, so the storefront homepage is
  // never touched by any rewrite.
  matcher: ["/admin/:path*", "/tasks/:path*", "/shop/tasks/:path*"],
};
