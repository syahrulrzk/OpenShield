import { redirect } from "next/navigation";
import { getSession } from "@/lib/security/rbac";
import { prisma } from "@/lib/db";
import { SettingsClient } from "./_components/settings-client";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // Fetch users + settings
  const [users, settings] = await Promise.all([
    prisma.user.findMany({
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
    }),
    prisma.systemSetting.findMany(),
  ]);

  const settingsMap: Record<string, unknown> = {
    registration_enabled: true,
    alert_min_severity: "MEDIUM",
    webhook_enabled: false,
    webhook_url: "",
  };
  for (const s of settings) {
    try {
      settingsMap[s.key] = JSON.parse(s.value);
    } catch {
      /* ignore */
    }
  }

  return (
    <SettingsClient
      currentUserId={session.userId}
      currentUser={{ id: session.userId, role: session.role }}
      users={users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        isActive: u.isActive,
        mfaEnabled: u.mfaEnabled,
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        createdAt: u.createdAt.toISOString(),
        assetCount: u._count.assets,
      }))}
      settings={settingsMap as any}
    />
  );
}
