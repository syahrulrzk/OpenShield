/**
 * /api/users — User management (OWNER/ADMIN only)
 *
 * GET   /api/users        list all users
 * POST  /api/users        create user (OWNER only) — sets initial password
 */

import { prisma } from "@/lib/db";
import { requireRole, PERMISSIONS } from "@/lib/security/rbac";
import { hashPassword } from "@/lib/security/password";
import { audit } from "@/lib/security/audit";
import { z } from "zod";

const createSchema = z.object({
  email: z.string().email().max(255).toLowerCase().trim(),
  name: z.string().min(1).max(100).optional(),
  role: z.enum(["OWNER", "ADMIN", "VIEWER"]).default("VIEWER"),
  password: z.string().min(12).max(128),
});

export async function GET() {
  const auth = await requireRole(...PERMISSIONS.USER_READ);
  if (auth instanceof Response) return auth;

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      mfaEnabled: true,
      lastLoginAt: true,
      createdAt: true,
      _count: { select: { assets: true } },
    },
  });
  return Response.json({ users });
}

export async function POST(req: Request) {
  const auth = await requireRole(...PERMISSIONS.USER_WRITE);
  if (auth instanceof Response) return auth;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ua = req.headers.get("user-agent") ?? undefined;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validasi gagal", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const data = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) {
    return Response.json({ error: "Email sudah terdaftar" }, { status: 409 });
  }

  // OWNER-only check for creating OWNER role
  if (data.role === "OWNER" && auth.role !== "OWNER") {
    return Response.json(
      { error: "Hanya OWNER yang bisa create OWNER user" },
      { status: 403 }
    );
  }

  const passwordHash = await hashPassword(data.password);
  const user = await prisma.user.create({
    data: {
      email: data.email,
      name: data.name,
      role: data.role,
      passwordHash,
    },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });

  await audit({
    userId: auth.userId,
    action: "user.create",
    resourceType: "user",
    resourceId: user.id,
    ip,
    userAgent: ua,
    metadata: { email: user.email, role: user.role },
  });

  return Response.json({ user }, { status: 201 });
}
