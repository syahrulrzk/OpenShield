/**
 * /api/settings — system settings (OWNER/ADMIN only)
 *
 * GET  /api/settings    get all settings
 * PATCH /api/settings   update settings
 *
 * Settings are stored in SystemSetting table (key-value)
 */

import { prisma } from "@/lib/db";
import { requireRole, PERMISSIONS } from "@/lib/security/rbac";
import { audit } from "@/lib/security/audit";

const SETTING_KEYS = [
  "registration_enabled",
  "alert_min_severity",
  "webhook_enabled",
  "webhook_url",
] as const;

const DEFAULTS: Record<string, unknown> = {
  registration_enabled: true,
  alert_min_severity: "MEDIUM",
  webhook_enabled: false,
  webhook_url: "",
};

export async function GET() {
  const auth = await requireRole(...PERMISSIONS.SETTINGS_READ);
  if (auth instanceof Response) return auth;

  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: [...SETTING_KEYS] } },
  });

  const out: Record<string, unknown> = { ...DEFAULTS };
  for (const r of rows) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      out[r.key] = DEFAULTS[r.key];
    }
  }
  return Response.json({ settings: out });
}

const updateSchema = {
  registration_enabled: (v: unknown) => typeof v === "boolean",
  alert_min_severity: (v: unknown) =>
    typeof v === "string" && ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(v),
  webhook_enabled: (v: unknown) => typeof v === "boolean",
  webhook_url: (v: unknown) => typeof v === "string" && v.length <= 2048,
};

export async function PATCH(req: Request) {
  const auth = await requireRole(...PERMISSIONS.SETTINGS_WRITE);
  if (auth instanceof Response) return auth;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ua = req.headers.get("user-agent") ?? undefined;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const updates: { key: string; value: unknown }[] = [];
  for (const [key, validator] of Object.entries(updateSchema)) {
    if (key in body) {
      if (!validator(body[key])) {
        return Response.json({ error: `Invalid value for ${key}` }, { status: 400 });
      }
      updates.push({ key, value: body[key] });
    }
  }

  for (const { key, value } of updates) {
    await prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: JSON.stringify(value), updatedBy: auth.userId },
      update: { value: JSON.stringify(value), updatedBy: auth.userId },
    });
    await audit({
      userId: auth.userId,
      action: "settings.update",
      resourceType: "setting",
      resourceId: key,
      ip,
      userAgent: ua,
      metadata: { value },
    });
  }

  return Response.json({ ok: true, updated: updates.length });
}
