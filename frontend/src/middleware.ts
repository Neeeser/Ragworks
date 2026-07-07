import { NextRequest, NextResponse } from "next/server";

// Next.js bakes `next.config.ts`'s `rewrites()` result into the build-time
// routes manifest — it is not re-evaluated when the standalone server starts,
// so an env var read inside `rewrites()` only ever sees its build-time value
// (typically unset, since the Docker image is built without a backend to
// point at). Middleware runs per request instead, so it is the only place a
// same-origin `/api/*` proxy target can genuinely be resolved at container
// runtime via `API_PROXY_TARGET`.
export function middleware(request: NextRequest): NextResponse {
  const target = process.env.API_PROXY_TARGET?.replace(/\/$/, "");
  if (!target) {
    return NextResponse.next();
  }
  const destination = new URL(request.nextUrl.pathname + request.nextUrl.search, target);
  return NextResponse.rewrite(destination);
}

export const config = {
  matcher: "/api/:path*",
};
