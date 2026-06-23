import { prisma } from "@/lib/db";
import { getSession } from "@/lib/security/rbac";
import { Box, Key, Activity, ShieldCheck, Webhook } from "lucide-react";
import { subHours } from "date-fns";
import { AppsTable, type App } from "./_components/apps-table";

const APP_TYPE_META: Record<string, { label: string; color: string }> = {
  web: { label: "Web App", color: "#3b82f6" },
  saas: { label: "SaaS", color: "#8b5cf6" },
  internal: { label: "Internal", color: "#10b981" },
  api: { label: "API", color: "#f59e0b" },
  mobile: { label: "Mobile", color: "#ec4899" },
  cli: { label: "CLI", color: "#71717a" },
};

const ENV_META: Record<string, { label: string; color: string }> = {
  PROD: { label: "Production", color: "#ef4444" },
  STAGING: { label: "Staging", color: "#f97316" },
  UAT: { label: "UAT", color: "#3b82f6" },
  DEV: { label: "Dev", color: "#71717a" },
  DR: { label: "DR", color: "#a855f7" },
};

export default async function AppsPage() {
  const session = await getSession();
  if (!session) return null;

  const since = subHours(new Date(), 24);

  // Pull all APP assets for this user
  const assets = await prisma.asset.findMany({
    where: { userId: session.userId, category: "APP" },
    select: {
      id: true,
      displayName: true,
      hostname: true,
      appType: true,
      authMethod: true,
      ownerTeam: true,
      webhookUrl: true,
      environment: true,
      location: true,
      description: true,
      status: true,
      apiKeyPrefix: true,
      apiKeyLast4: true,
      apiKeyCreatedAt: true,
      apiKeyLastUsedAt: true,
      lastSeenAt: true,
      createdAt: true,
    },
    orderBy: [{ status: "asc" }, { displayName: "asc" }],
  });

  // 24h event counts + top actor + last event per app
  // assetId is nullable; use Prisma `not: { equals: undefined }` to skip nulls
  const eventCounts = await prisma.tEventLogUserAccess.groupBy({
    by: ["assetId"],
    where: {
      assetId: { not: undefined as any },
      eventTime: { gte: since },
    },
    _count: { _all: true },
  });
  const errorCounts = await prisma.tEventLogUserAccess.groupBy({
    by: ["assetId"],
    where: {
      assetId: { not: undefined as any },
      eventTime: { gte: since },
      severity: { in: ["ERROR", "WARN"] },
    },
    _count: { _all: true },
  });
  const countMap = new Map<string, number>(
    eventCounts
      .filter((c) => c.assetId !== null)
      .map((c) => [c.assetId as string, c._count?._all ?? 0])
  );
  const errMap = new Map<string, number>(
    errorCounts
      .filter((c) => c.assetId !== null)
      .map((c) => [c.assetId as string, c._count?._all ?? 0])
  );

  // Last event timestamp per app
  const lastEvents = await prisma.tEventLogUserAccess.findMany({
    where: {
      assetId: { in: assets.map((a) => a.id) },
    },
    orderBy: { eventTime: "desc" },
    distinct: ["assetId"],
    select: { assetId: true, eventTime: true, eventType: true, severity: true, actorEmail: true },
  });
  const lastEventMap = new Map(
    lastEvents.map((e) => [e.assetId!, e])
  );

  const apps: App[] = assets.map((a) => ({
    id: a.id,
    displayName: a.displayName ?? a.hostname,
    hostname: a.hostname,
    appType: a.appType,
    authMethod: a.authMethod,
    ownerTeam: a.ownerTeam,
    webhookUrl: a.webhookUrl,
    environment: a.environment,
    location: a.location,
    description: a.description,
    status: a.status,
    apiKeyPrefix: a.apiKeyPrefix,
    apiKeyLast4: a.apiKeyLast4,
    apiKeyCreatedAt: a.apiKeyCreatedAt?.toISOString() ?? null,
    apiKeyLastUsedAt: a.apiKeyLastUsedAt?.toISOString() ?? null,
    lastSeenAt: a.lastSeenAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
    eventCount24h: countMap.get(a.id) ?? 0,
    warnErrorCount24h: errMap.get(a.id) ?? 0,
    lastEvent: lastEventMap.has(a.id)
      ? {
          eventType: lastEventMap.get(a.id)!.eventType,
          severity: lastEventMap.get(a.id)!.severity,
          actorEmail: lastEventMap.get(a.id)!.actorEmail,
          eventTime: lastEventMap.get(a.id)!.eventTime.toISOString(),
        }
      : null,
  }));

  // Stats
  const totalApps = apps.length;
  const appsWithKey = apps.filter((a) => a.apiKeyPrefix).length;
  const appsWithoutKey = totalApps - appsWithKey;
  const activeApps = apps.filter(
    (a) => a.apiKeyLastUsedAt &&
      new Date(a.apiKeyLastUsedAt).getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000
  ).length;
  const totalEvents24h = apps.reduce((s, a) => s + a.eventCount24h, 0);

  // App type counts
  const typeCounts: Record<string, number> = {};
  for (const a of apps) {
    const t = a.appType ?? "web";
    typeCounts[t] = (typeCounts[t] ?? 0) + 1;
  }
  const typeStrip = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Box className="h-6 w-6 text-violet-500" />
            Applications
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Inventory of integrated apps. Apps send user access events via API key webhook.
          </p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={<Box className="h-5 w-5" />}
          label="Total Apps"
          value={totalApps}
          color="#3b82f6"
        />
        <StatCard
          icon={<Key className="h-5 w-5" />}
          label="API Keys"
          value={`${appsWithKey} / ${totalApps}`}
          color="#10b981"
        />
        <StatCard
          icon={<Activity className="h-5 w-5" />}
          label="Active (7d)"
          value={activeApps}
          color="#f59e0b"
        />
        <StatCard
          icon={<Webhook className="h-5 w-5" />}
          label="Events 24h"
          value={totalEvents24h}
          color="#8b5cf6"
        />
      </div>

      {/* App type strip */}
      {typeStrip.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {typeStrip.map(([type, count]) => {
            const meta = APP_TYPE_META[type] ?? APP_TYPE_META.web;
            return (
              <div
                key={type}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900"
                style={{ borderLeftWidth: 3, borderLeftColor: meta.color }}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: meta.color }} />
                <span className="text-xs font-medium">{meta.label}</span>
                <span className="text-xs text-zinc-500">{count}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Apps table */}
      <AppsTable apps={apps} envMeta={ENV_META} typeMeta={APP_TYPE_META} />

      {appsWithoutKey > 0 && (
        <div className="text-xs text-zinc-500 px-2">
          {appsWithoutKey} app{appsWithoutKey === 1 ? "" : "s"} without API key — click{" "}
          <span className="font-semibold">Generate Key</span> on the row to create one.
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color: string;
}) {
  return (
    <div
      className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4"
      style={{ borderTopWidth: 3, borderTopColor: color }}
    >
      <div className="flex items-center justify-between text-zinc-500 text-xs">
        <span className="uppercase tracking-wider">{label}</span>
        <div style={{ color }}>{icon}</div>
      </div>
      <div className="text-2xl font-bold mt-2">{value}</div>
    </div>
  );
}
