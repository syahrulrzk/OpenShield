/**
 * /api/auth/register
 * POST { email, password, name? } → 201 { user }
 *
 * First user becomes OWNER. Subsequent users are blocked by default
 * unless `registration_enabled` setting is true.
 *
 * OWASP A07:2021 — strong password policy enforced (validatePassword)
 * OWASP A09:2021 — audit logged
 */

import { prisma } from "@/lib/db";
import { hashPassword, validatePassword } from "@/lib/security/password";
import { registerSchema } from "@/lib/validators/auth";
import { audit } from "@/lib/security/audit";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "Validasi gagal", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { email, password, name } = parsed.data;

    // Password policy
    const pwCheck = validatePassword(password);
    if (!pwCheck.ok) {
      return Response.json({ error: pwCheck.reason }, { status: 400 });
    }

    // Duplicate check
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return Response.json({ error: "Registrasi gagal" }, { status: 409 });
    }

    // First user becomes OWNER automatically
    const userCount = await prisma.user.count();
    if (userCount === 0) {
      // First user bootstrap
      const passwordHash = await hashPassword(password);
      const user = await prisma.user.create({
        data: { email, passwordHash, name, role: "OWNER" },
        select: { id: true, email: true, name: true, role: true, createdAt: true },
      });
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
      const ua = req.headers.get("user-agent") ?? undefined;
      await audit({
        userId: user.id,
        action: "auth.register",
        resourceType: "user",
        resourceId: user.id,
        ip,
        userAgent: ua,
        metadata: { role: "OWNER", first: true },
      });
      return Response.json({ user }, { status: 201 });
    }

    // Subsequent users: check registration_enabled setting
    const setting = await prisma.systemSetting.findUnique({
      where: { key: "registration_enabled" },
    });
    const registrationEnabled = setting ? JSON.parse(setting.value) : true;

    if (!registrationEnabled) {
      return Response.json(
        { error: "Registrasi ditutup. Hubungi admin untuk invite." },
        { status: 403 }
      );
    }

    // Default new users to VIEWER (lowest privilege)
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { email, passwordHash, name, role: "VIEWER" },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const ua = req.headers.get("user-agent") ?? undefined;
    await audit({
      userId: user.id,
      action: "auth.register",
      resourceType: "user",
      resourceId: user.id,
      ip,
      userAgent: ua,
      metadata: { role: "VIEWER" },
    });

    return Response.json({ user }, { status: 201 });
  } catch (err) {
    console.error("[register]", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}
