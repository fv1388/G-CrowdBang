import { NextRequest, NextResponse } from "next/server";

/**
 * G-CrowdBang — multi-tenant path-based routing proxy (Next.js App Router).
 *
 * Responsibilities (path routing only, no logic beyond route dispatch):
 *  1. `/admin`, `/admin/...`       -> domestic-merchant admin console section
 *     (rewards / bounty publishing space). Already maps natively to
 *     `src/app/admin/**`, so the request passes through untouched and every
 *     admin sub-route (dashboard / create / detail) is preserved.
 *  2. `/tasks`, `/tasks/...`       -> overseas task hall section, internally
 *     rewritten to `/shop/tasks` (and `/shop/tasks/...` for sub-paths). The URL
 *     bar keeps the original `/tasks` path while the router renders the task
 *     hall. `/shop/tasks` itself already maps natively and passes through.
 *  3. `/` (root, no tenant prefix) -> pass through unchanged.
 *
 * The proxy performs an INTERNAL REWRITE via `NextResponse.rewrite(...)`. The
 * URL bar keeps the original path, while the router renders the target app
 * section on the server. Routing is deterministic and fast (pure string prefix
 * checks, executed before any page render).
 */

const TASK_PREFIX = "/tasks";
const TASK_HALL = "/shop/tasks";

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
    // Internal rewrite of the whole task-hall section: map `/tasks[/...]`
    // onto `/shop/tasks[/...]`, preserving any sub-path.
    return TASK_HALL + pathname.slice(TASK_PREFIX.length);
  }

  // `/admin`, `/admin/*`, `/shop/tasks`, `/shop/tasks/*`, and `/` all already
  // resolve natively under src/app/** — pass through to preserve sub-routes.
  return null;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const target = resolveRewriteTarget(pathname);
  if (target) {
    return NextResponse.rewrite(new URL(target, request.url));
  }

  // Admin console section, task hall itself, root storefront, and everything
  // else: green-light pass through (no rewrite / no pollution).
  return NextResponse.next();
}

export const config = {
  // Only intercept the paths this proxy is responsible for.
  // `/` itself is intentionally NOT matched, so the storefront homepage is
  // never touched by any rewrite.
  matcher: ["/admin/:path*", "/tasks/:path*", "/shop/tasks/:path*"],
};
