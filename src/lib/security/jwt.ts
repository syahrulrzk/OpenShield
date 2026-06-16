/**
 * OpenShield — JWT access tokens (jose, HS256)
 *
 * OWASP A07:2021 — short-lived access tokens (15 min) + rotating refresh tokens
 * Token claims: { sub, role, iat, exp, jti }
 *
 * Refresh tokens are random 32-byte strings, hashed in DB (SHA-256), single-use.
 */

import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { randomBytes, createHash } from "node:crypto";

const ALGO = "HS256";
const ACCESS_EXPIRY = "15m";

function getSecret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error("SESSION_SECRET must be set (min 32 chars)");
  }
  return new TextEncoder().encode(s);
}

export type AccessTokenClaims = {
  sub: string;       // userId
  role: "OWNER" | "ADMIN" | "VIEWER";
  email: string;
};

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: ALGO, typ: "JWT" })
    .setIssuedAt()
    .setIssuer("openshield")
    .setAudience("openshield-api")
    .setExpirationTime(ACCESS_EXPIRY)
    .setJti(randomBytes(16).toString("hex"))
    .sign(getSecret());
}

export async function verifyAccessToken(token: string): Promise<JWTPayload & AccessTokenClaims> {
  const { payload } = await jwtVerify(token, getSecret(), {
    issuer: "openshield",
    audience: "openshield-api",
  });
  return payload as JWTPayload & AccessTokenClaims;
}

// ---- Refresh tokens ----

/** Generate a fresh refresh token (raw, return to client ONCE) */
export function generateRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  const hash = hashRefreshToken(raw);
  return { raw, hash };
}

/** SHA-256 hash of refresh token (for DB storage) */
export function hashRefreshToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
