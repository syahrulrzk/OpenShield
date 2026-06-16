/**
 * /api/users/[id] — Update/delete user (OWNER/ADMIN)
 *
 * PATCH  /api/users/[id]  update role or active status
 * DELETE /api/users/[id]  soft-delete (deactivate)
 */

import { prisma } from "@/lib/db";
import { requireRole, PERMISSIONS } from "@/lib/security/rbac";
import { audit } from "@/lib/security/audit";
import { z } from "zod";

const updateSchema = z.object({
  role: z.enum(["OWNER", "ADMIN", "VIEWER"]).optional(),
  isActive: z.boolean().optional(),
  name: z.string().min(1).max(100).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(...PERMISSIONS.USER_WRITE);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ua = req.headers.get("user-agent") ?? undefined;

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validasi gagal", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const data = parsed.data;

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    return Response.json({ error: "User tidak ditemukan" }, { status: 404 });
  }

  // Only OWNER can change roles
  if (data.role && data.role !== target.role && auth.role !== "OWNER") {
    return Response.json(
      { error: "Hanya OWNER yang bisa ubah role" },
      { status: 403 }
    );
  }

  // Can't demote the last OWNER
  if (data.role && target.role === "OWNER" && data.role !== "OWNER") {
    const ownerCount = await prisma.user.count({ where: { role: "OWNER", isActive: true } });
    if (ownerCount <= 1) {
      return Response.json(
        { error: "Tidak bisa demote OWNER terakhir" },
        { status: 400 }
      );
    }
  }

  // Can't deactivate self
  if (data.isActive === false && id === auth.userId) {
    return Response.json(
      { error: "Tidak bisa deactivate akun sendiri" },
      { status: 400 }
    );
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, email: true, name: true, role: true, isActive: true },
  });

  await audit({
    userId: auth.userId,
    action: "user.update",
    resourceType: "user",
    resourceId: id,
    ip,
    userAgent: ua,
    metadata: data,
  });

  return Response.json({ user });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(...PERMISSIONS.USER_WRITE);
  if (auth instanceof Response) return auth;

  const { id } = await params;

  if (id === auth.userId) {
    return Response.json(
      { error: "Tidak bisa hapus akun sendiri" },
      { status: 400 }
    );
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    return Response.json({ error: "User tidak ditemukan" }, { status: 404 });
  }

  // Soft delete: set isActive = false
  await prisma.user.update({
    where: { id },
    data: { isActive: false },
  });

  // Revoke all refresh tokens
  await prisma.refreshToken.updateMany({
    where: { userId: id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await audit({
    userId: auth.userId,
    action: "user.delete",
    resourceType: "user",
    resourceId: id,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
    userAgent: req.headers.get("user-agent") ?? undefined,
  });

  return Response.json({ ok: true });
}
