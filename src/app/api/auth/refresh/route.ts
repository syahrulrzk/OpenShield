/**
 * /api/auth/refresh
 * POST { refreshToken } (or read from cookie) → { accessToken, refreshToken (new) }
 *
 * Rotates refresh token: old one revoked, new one issued.
 * OWASP A07:2021 — token rotation prevents replay attacks.
 */

import { prisma } from "@/lib/db";
import { signAccessToken, generateRefreshToken, hashRefreshToken } from "@/lib/security/jwt";
import { cookies } from "next/headers";

export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const cookieToken = cookieStore.get("os_refresh")?.value;
    const body = await req.json().catch(() => null);
    const tokenFromBody = body?.refreshToken;
    const raw = cookieToken || tokenFromBody;
    if (!raw) {
      return Response.json({ error: "No refresh token" }, { status: 401 });
    }

    const hash = hashRefreshToken(raw);
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      return Response.json({ error: "Invalid refresh token" }, { status: 401 });
    }

    // Check reuse → if already used, revoke entire family (theft detection)
    if (stored.usedAt) {
      await prisma.refreshToken.updateMany({
        where: { userId: stored.userId },
        data: { revokedAt: new Date() },
      });
      return Response.json({ error: "Refresh token reuse detected" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user || !user.isActive) {
      return Response.json({ error: "User inactive" }, { status: 401 });
    }

    // Rotate
    const newRefresh = generateRefreshToken();
    await prisma.$transaction([
      prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date(), usedAt: new Date() },
      }),
      prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: newRefresh.hash,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      }),
    ]);

    const accessToken = await signAccessToken({
      sub: user.id,
      role: user.role as "OWNER" | "ADMIN" | "VIEWER",
      email: user.email,
    });

    // Set cookies — Secure flag only when explicitly enabled (HTTPS) or when running behind TLS-terminating proxy
    const cookieSecure = process.env.COOKIE_SECURE
      ? process.env.COOKIE_SECURE === "true"
      : process.env.NODE_ENV === "production";
    const secure = cookieSecure ? "; Secure" : "";
    const cookieHeader = [
      `os_access=${accessToken}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=900`,
      `os_refresh=${newRefresh.raw}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${7 * 24 * 60 * 60}`,
    ].join(", ");

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Set-Cookie": cookieHeader },
    });
  } catch (err) {
    console.error("[refresh]", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}
