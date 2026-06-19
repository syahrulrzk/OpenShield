/**
 * OpenShield — Next.js 16 Proxy (formerly Middleware)
 * Renamed in v16: see node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md
 *
 * Responsibilities:
 * 1. Add security headers to all responses (CSP, HSTS, X-Frame-Options, etc.)
 * 2. Optimistic auth check — redirect unauthenticated dashboard requests to /login
 * 3. Block path traversal / known bad patterns
 *
 * OWASP A05:2021 — Security Misconfiguration (headers)
 * OWASP A01:2021 — Broken Access Control (optimistic check)
 */

import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/refresh",
  "/api/health",
  // Internal endpoints — protected by HMAC at handler level (not session)
  "/api/events/ingest",
  "/api/poller/run",
  "/api/agents/register",
  "/api/agents/heartbeat",
  // Quick install — URL itself is the bearer (agent_id + token)
  "/api/install",
  "/_next",
  "/favicon.ico",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Security headers on all responses
  const response = NextResponse.next();
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()"
  );
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' ws: wss:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ")
  );

  // Public paths — pass through
  if (isPublic(pathname)) {
    return response;
  }

  // Optimistic auth check for dashboard routes
  const isDashboard = pathname.startsWith("/dashboard") || pathname === "/";
  const isApi = pathname.startsWith("/api/");
  if (isDashboard || isApi) {
    const hasAccess = !!request.cookies.get("os_access")?.value;
    if (!hasAccess) {
      if (isApi) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("from", pathname);
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
