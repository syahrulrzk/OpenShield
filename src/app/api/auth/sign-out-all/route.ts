/**
 * /api/auth/sign-out-all
 * POST → { ok } | 401
 *
 * Revokes all refresh tokens for the current user (signs out every device).
 */

import { getSession } from "@/lib/security/rbac";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/security/audit";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || undefined;
  const ua = req.headers.get("user-agent") || undefined;

  await prisma.refreshToken.deleteMany({
    where: { userId: session.userId },
  });

  await audit({
    userId: session.userId,
    action: "user.update",
    resourceType: "user",
    resourceId: session.userId,
    ip,
    userAgent: ua,
    metadata: { change: "revoke_all_sessions" },
  });

  return Response.json({ ok: true });
}
