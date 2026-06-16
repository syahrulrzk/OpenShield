/**
 * /api/auth/logout
 * POST → revokes current refresh token, clears cookies
 */

import { prisma } from "@/lib/db";
import { hashRefreshToken } from "@/lib/security/jwt";
import { cookies } from "next/headers";
import { getSession } from "@/lib/security/rbac";
import { audit } from "@/lib/security/audit";

export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const refresh = cookieStore.get("os_refresh")?.value;
    const session = await getSession();
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const ua = req.headers.get("user-agent") ?? undefined;

    if (refresh) {
      const hash = hashRefreshToken(refresh);
      await prisma.refreshToken.updateMany({
        where: { tokenHash: hash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    if (session) {
      await audit({ userId: session.userId, action: "auth.logout", ip, userAgent: ua });
    }

    // Set cookies — Secure flag only when explicitly enabled (HTTPS) or when running behind TLS-terminating proxy
    const cookieSecure = process.env.COOKIE_SECURE
      ? process.env.COOKIE_SECURE === "true"
      : process.env.NODE_ENV === "production";
    const secure = cookieSecure ? "; Secure" : "";
    const cookieHeader = [
      `os_access=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`,
      `os_refresh=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`,
    ].join(", ");

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Set-Cookie": cookieHeader },
    });
  } catch (err) {
    console.error("[logout]", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}
