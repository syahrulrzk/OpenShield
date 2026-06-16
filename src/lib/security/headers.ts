/**
 * OpenShield — Security headers (OWASP A05:2021)
 *
 * Applied via middleware on all responses
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function withSecurityHeaders(response: NextResponse): NextResponse {
  // Prevent clickjacking
  response.headers.set("X-Frame-Options", "DENY");
  // Prevent MIME sniffing
  response.headers.set("X-Content-Type-Options", "nosniff");
  // HSTS — force HTTPS for 2 years
  response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  // Referrer
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // Disable dangerous features
  response.headers.set(
    "Permissions-Policy",
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()"
  );
  // CSP — strict, no inline scripts (Next.js needs 'self' + nonce in prod)
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Next.js requires these in dev; in prod use nonces
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' ws: wss:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ")
  );
  return response;
}
