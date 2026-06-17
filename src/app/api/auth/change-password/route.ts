/**
 * /api/auth/change-password
 * POST { currentPassword, newPassword } → { ok } | 400/401
 *
 * - Verifies current password (Argon2id verify)
 * - Validates new password (min 12 chars)
 * - Hashes new password with Argon2id
 * - Updates user record
 * - Revokes all refresh tokens (force re-login on other devices)
 * - Logs audit event
 */

import { z } from "zod";
import { getSession } from "@/lib/security/rbac";
import { prisma } from "@/lib/db";
import { verifyPassword, hashPassword } from "@/lib/security/password";
import { audit } from "@/lib/security/audit";

const Body = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12, "Password must be at least 12 characters"),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const { currentPassword, newPassword } = parsed.data;
  if (currentPassword === newPassword) {
    return Response.json(
      { error: "New password must differ from current" },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, passwordHash: true },
  });
  if (!user) return Response.json({ error: "User not found" }, { status: 404 });

  const ok = await verifyPassword(user.passwordHash, currentPassword);
  if (!ok) return Response.json({ error: "Current password is incorrect" }, { status: 401 });

  const newHash = await hashPassword(newPassword);
  const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || undefined;
  const ua = req.headers.get("user-agent") || undefined;

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    }),
    prisma.refreshToken.deleteMany({
      where: { userId: user.id },
    }),
  ]);

  await audit({
    userId: user.id,
    action: "user.update",
    resourceType: "user",
    resourceId: user.id,
    ip,
    userAgent: ua,
    metadata: { change: "password" },
  });

  return Response.json({ ok: true });
}
