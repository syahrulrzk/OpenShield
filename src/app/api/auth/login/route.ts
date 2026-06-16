/**
 * /api/auth/login
 * POST { email, password } → { accessToken, refreshToken, user }
 * Sets httpOnly cookies too.
 *
 * OWASP A07:2021 — rate limit (5/15min), strong password verify (Argon2id)
 * OWASP A09:2021 — audit log (success + failure)
 */

import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/security/password";
import { signAccessToken, generateRefreshToken, hashRefreshToken } from "@/lib/security/jwt";
import { loginSchema } from "@/lib/validators/auth";
import { check, LIMITS } from "@/lib/security/ratelimit";
import { audit } from "@/lib/security/audit";

const REFRESH_TTL_DAYS = 7;

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const ua = req.headers.get("user-agent") ?? undefined;

    // Rate limit
    const rl = check(`login:${ip}`, LIMITS.login);
    if (!rl.ok) {
      return Response.json(
        { error: "Terlalu banyak percobaan login. Coba lagi nanti." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "Email atau password salah" }, { status: 401 });
    }
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      // Constant-time-ish: still verify a dummy hash to prevent timing attacks
      await verifyPassword("$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", password).catch(() => {});
      await audit({ action: "auth.login.failed", ip, userAgent: ua, metadata: { email, reason: "user_not_found" } });
      return Response.json({ error: "Email atau password salah" }, { status: 401 });
    }

    const valid = await verifyPassword(user.passwordHash, password);
    if (!valid) {
      await audit({ userId: user.id, action: "auth.login.failed", ip, userAgent: ua, metadata: { reason: "bad_password" } });
      return Response.json({ error: "Email atau password salah" }, { status: 401 });
    }

    // Issue tokens
    const accessToken = await signAccessToken({
      sub: user.id,
      role: user.role as "OWNER" | "ADMIN" | "VIEWER",
      email: user.email,
    });
    const refresh = generateRefreshToken();
    const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refresh.hash,
        expiresAt,
        ip,
        userAgent: ua,
      },
    });

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastLoginIp: ip },
    });

    // Set cookies — Secure flag only when explicitly enabled (HTTPS) or when running behind TLS-terminating proxy
    // Defaults: Secure ON in production, OFF otherwise. Override with COOKIE_SECURE=true|false
    const cookieSecure = process.env.COOKIE_SECURE
      ? process.env.COOKIE_SECURE === "true"
      : process.env.NODE_ENV === "production";
    const secure = cookieSecure ? "; Secure" : "";
    const cookieHeader = [
      `os_access=${accessToken}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=900`,
      `os_refresh=${refresh.raw}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${REFRESH_TTL_DAYS * 24 * 60 * 60}`,
    ].join(", ");

    await audit({ userId: user.id, action: "auth.login.success", ip, userAgent: ua });

    return new Response(
      JSON.stringify({
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": cookieHeader,
        },
      }
    );
  } catch (err) {
    console.error("[login]", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}
