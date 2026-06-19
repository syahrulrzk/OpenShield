import { prisma } from "@/lib/db";
import { getSession } from "@/lib/security/rbac";
import { AddAssetButton } from "./_components/add-asset-button";
import { AssetActions } from "./_components/asset-actions";
import {
  Server,
  Circle,
  Database,
  Terminal,
  AppWindow,
  ListFilter,
  Globe,
  Rocket,
  FlaskConical,
  Code2,
  Shield,
} from "lucide-react";
import Link from "next/link";

const DB_TYPE_BADGE: Record<string, { label: string; color: string }> = {
  POSTGRES: { label: "Postgres", color: "#336791" },
  MYSQL: { label: "MySQL", color: "#00758f" },
  SQLSERVER: { label: "SQL Server", color: "#cc2927" },
};

const CATEGORY_META: Record<
  string,
  {
    label: string;
    icon: React.ComponentType<{
      className?: string;
      strokeWidth?: number;
      style?: React.CSSProperties;
    }>;
    color: string;
  }
> = {
  SSH: { label: "Akses SSH", icon: Terminal, color: "#10b981" },
  DATABASE: { label: "Akses Database", icon: Database, color: "#3b82f6" },
  APP: { label: "Akses Apps", icon: AppWindow, color: "#a855f7" },
};

const ENV_META: Record<
  string,
  {
    label: string;
    color: string;
    icon: React.ComponentType<{
      className?: string;
      strokeWidth?: number;
      style?: React.CSSProperties;
    }>;
  }
> = {
  PROD: { label: "Production", color: "#ef4444", icon: Shield },
  STAGING: { label: "Staging", color: "#f97316", icon: Rocket },
  UAT: { label: "UAT", color: "#3b82f6", icon: FlaskConical },
  DEV: { label: "Dev", color: "#10b981", icon: Code2 },
  DR: { label: "DR", color: "#a855f7", icon: Globe },
};

type FilterCat = "ALL" | "SSH" | "DATABASE" | "APP";
type FilterEnv = "ALL" | "PROD" | "STAGING" | "UAT" | "DEV" | "DR";

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; environment?: string }>;
}) {
  const session = await getSession();
  if (!session) return null;

  const params = await searchParams;
  const filter = (
    ["ALL", "SSH", "DATABASE", "APP"].includes(params.category ?? "")
      ? (params.category as FilterCat)
      : "ALL"
  ) as FilterCat;
  const envFilter = (
    ["ALL", "PROD", "STAGING", "UAT", "DEV", "DR"].includes(params.environment ?? "")
      ? (params.environment as FilterEnv)
      : "ALL"
  ) as FilterEnv;

  // Counts for tabs
  const counts = await prisma.asset.groupBy({
    by: ["category"],
    where: { userId: session.userId },
    _count: { _all: true },
  });
  const countMap: Record<string, number> = { SSH: 0, DATABASE: 0, APP: 0 };
  for (const c of counts) countMap[c.category] = c._count._all;
  const totalCount = countMap.SSH + countMap.DATABASE + countMap.APP;

  const envCounts = await prisma.asset.groupBy({
    by: ["environment"],
    where: {
      userId: session.userId,
      ...(filter !== "ALL" ? { category: filter } : {}),
    },
    _count: { _all: true },
  });
  const envCountMap: Record<string, number> = {
    PROD: 0, STAGING: 0, UAT: 0, DEV: 0, DR: 0,
  };
  for (const c of envCounts) envCountMap[c.environment] = c._count._all;

  const assets = await prisma.asset.findMany({
    where: {
      userId: session.userId,
      ...(filter !== "ALL" ? { category: filter } : {}),
      ...(envFilter !== "ALL" ? { environment: envFilter } : {}),
    },
    orderBy: [{ environment: "asc" }, { displayName: "asc" }, { hostname: "asc" }],
    select: {
      id: true,
      category: true,
      environment: true,
      displayName: true,
      hostname: true,
      publicIp: true,
      privateIp: true,
      os: true,
      sshUser: true,
      dbType: true,
      status: true,
      lastSeenAt: true,
    },
  });

  const filterTabs: { id: FilterCat; label: string; count: number; icon: React.ComponentType<{ className?: string; strokeWidth?: number }> }[] = [
    { id: "ALL", label: "All", count: totalCount, icon: ListFilter },
    { id: "SSH", label: "Akses SSH", count: countMap.SSH, icon: Terminal },
    { id: "DATABASE", label: "Akses Database", count: countMap.DATABASE, icon: Database },
    { id: "APP", label: "Akses Apps", count: countMap.APP, icon: AppWindow },
  ];

  const envTabs: { id: FilterEnv; label: string; count: number; color: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }> }[] = [
    { id: "ALL", label: "All env", count: Object.values(envCountMap).reduce((a, b) => a + b, 0), color: "#71717a", icon: Globe },
    { id: "PROD", label: "PROD", count: envCountMap.PROD, color: ENV_META.PROD.color, icon: ENV_META.PROD.icon },
    { id: "STAGING", label: "STAGING", count: envCountMap.STAGING, color: ENV_META.STAGING.color, icon: ENV_META.STAGING.icon },
    { id: "UAT", label: "UAT", count: envCountMap.UAT, color: ENV_META.UAT.color, icon: ENV_META.UAT.icon },
    { id: "DEV", label: "DEV", count: envCountMap.DEV, color: ENV_META.DEV.color, icon: ENV_META.DEV.icon },
    { id: "DR", label: "DR", count: envCountMap.DR, color: ENV_META.DR.color, icon: ENV_META.DR.icon },
  ];

  function buildAssetHref(cat?: FilterCat, env?: FilterEnv) {
    const c = cat ?? filter;
    const e = env ?? envFilter;
    const p = new URLSearchParams();
    if (c !== "ALL") p.set("category", c);
    if (e !== "ALL") p.set("environment", e);
    const q = p.toString();
    return q ? `/dashboard/assets?${q}` : "/dashboard/assets";
  }

  function hostIpOf(a: typeof assets[number]) {
    return a.publicIp || a.privateIp || "—";
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Assets</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            {totalCount} asset{totalCount !== 1 ? "s" : ""} being monitored
          </p>
        </div>
        <AddAssetButton />
      </div>

      {/* Category filter tabs */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.03] border border-[var(--border)] w-fit">
          {filterTabs.map((t) => {
            const Icon = t.icon;
            const active = filter === t.id;
            return (
              <Link
                key={t.id}
                href={buildAssetHref(t.id, envFilter)}
                scroll={false}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                  active
                    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-white/[0.04] border-transparent"
                }`}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={active ? 2.25 : 1.75} />
                <span>{t.label}</span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                    active
                      ? "bg-emerald-500/20 text-emerald-300"
                      : "bg-white/[0.04] text-[var(--muted-foreground)]"
                  }`}
                >
                  {t.count}
                </span>
              </Link>
            );
          })}
        </div>

        <div className="h-5 w-px bg-[var(--border)] mx-1 hidden sm:block" />
        <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.03] border border-[var(--border)] w-fit overflow-x-auto">
          {envTabs.map((t) => {
            const Icon = t.icon;
            const active = envFilter === t.id;
            return (
              <Link
                key={t.id}
                href={buildAssetHref(filter, t.id)}
                scroll={false}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all whitespace-nowrap border ${
                  active
                    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-white/[0.04] border-transparent"
                }`}
              >
                {t.id === "ALL" ? (
                  <Icon className="h-3 w-3" strokeWidth={active ? 2.25 : 1.75} />
                ) : (
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: t.color }}
                  />
                )}
                <span>{t.label}</span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                    active
                      ? "bg-emerald-500/20 text-emerald-300"
                      : "bg-white/[0.04] text-[var(--muted-foreground)]"
                  }`}
                >
                  {t.count}
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      {assets.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-[var(--border-strong)] p-12 text-center">
          <Server className="h-10 w-10 text-[var(--muted-foreground)] mx-auto" strokeWidth={1.5} />
          <h3 className="mt-4 text-sm font-semibold">No assets yet</h3>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Add your first asset to start monitoring SSH and database login events
          </p>
        </div>
      ) : (
        <>
          {/* ============ Mobile: card layout ============ */}
          <div className="md:hidden space-y-2">
            {assets.map((a) => {
              const lastSeen = a.lastSeenAt ? new Date(a.lastSeenAt) : null;
              const minutesAgo = lastSeen
                ? Math.floor((Date.now() - lastSeen.getTime()) / 60000)
                : null;
              const isOnline = a.status === "ONLINE";
              const catMeta = CATEGORY_META[a.category];
              const envMeta = ENV_META[a.environment];
              return (
                <div
                  key={a.id}
                  className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
                >
                  <Circle
                    className={`h-2 w-2 fill-current shrink-0 ${
                      isOnline ? "text-[var(--success)]"
                        : a.status === "ERROR" ? "text-[var(--danger)]"
                        : a.status === "PENDING" ? "text-[var(--warning)]"
                        : "text-[var(--muted)]"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-sm font-medium truncate">
                      {a.displayName || a.hostname}
                    </div>
                    <div className="text-[10px] text-[var(--muted-foreground)] font-mono truncate">
                      {a.displayName && a.displayName !== a.hostname ? `${a.hostname} · ` : ""}
                      {hostIpOf(a)}
                    </div>
                  </div>
                  <span
                    className="text-[9px] font-mono font-semibold tracking-wider px-1.5 py-0.5 rounded border shrink-0"
                    style={{
                      color: envMeta?.color,
                      borderColor: `${envMeta?.color}40`,
                      backgroundColor: `${envMeta?.color}10`,
                    }}
                  >
                    {a.environment}
                  </span>
                  <AssetActions asset={a as any} />
                </div>
              );
            })}
          </div>

          {/* ============ Desktop: table layout ============ */}
          <div className="hidden md:block rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-white/[0.02]">
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] w-24">
                    Status
                  </th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    Name
                  </th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] w-36">
                    Category
                  </th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] w-28">
                    Env
                  </th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] w-40">
                    Host IP
                  </th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] w-32">
                    OS
                  </th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] w-24">
                    Last seen
                  </th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] w-20">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => {
                  const lastSeen = a.lastSeenAt ? new Date(a.lastSeenAt) : null;
                  const minutesAgo = lastSeen
                    ? Math.floor((Date.now() - lastSeen.getTime()) / 60000)
                    : null;
                  const isOnline = a.status === "ONLINE";
                  const catMeta = CATEGORY_META[a.category];
                  const CatIcon = catMeta?.icon ?? Server;
                  const envMeta = ENV_META[a.environment];
                  return (
                    <tr
                      key={a.id}
                      className="border-b border-[var(--border)] last:border-0 hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <Circle
                            className={`h-2 w-2 fill-current ${
                              isOnline ? "text-[var(--success)]"
                                : a.status === "ERROR" ? "text-[var(--danger)]"
                                : a.status === "PENDING" ? "text-[var(--warning)]"
                                : "text-[var(--muted)]"
                            }`}
                          />
                          <span className="text-[11px] font-mono text-[var(--muted-foreground)]">
                            {a.status}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-mono text-sm font-medium">{a.displayName || a.hostname}</div>
                        {a.displayName && a.displayName !== a.hostname && (
                          <div className="text-[10px] text-[var(--muted-foreground)] font-mono">
                            {a.hostname}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <CatIcon
                            className="h-3.5 w-3.5"
                            strokeWidth={1.75}
                            style={{ color: catMeta?.color }}
                          />
                          <span
                            className="text-[11px] font-medium"
                            style={{ color: catMeta?.color }}
                          >
                            {a.category === "DATABASE" && a.dbType !== "NONE"
                              ? DB_TYPE_BADGE[a.dbType]?.label
                              : catMeta?.label}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-mono font-semibold tracking-wider"
                          style={{
                            color: envMeta?.color,
                            borderColor: `${envMeta?.color}40`,
                            backgroundColor: `${envMeta?.color}10`,
                          }}
                        >
                          {a.environment}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs font-mono text-[var(--muted-foreground)]">
                        {hostIpOf(a)}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-[var(--muted-foreground)] font-mono">
                        {a.os || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-[11px] text-[var(--muted-foreground)] font-mono">
                        {minutesAgo !== null ? `${minutesAgo}m ago` : "never"}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end">
                          <AssetActions asset={a as any} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="text-xs text-[var(--muted-foreground)]">
        <Link href="/dashboard" className="hover:text-[var(--foreground)] underline underline-offset-2">
          ← Back to overview
        </Link>
      </div>
    </div>
  );
}
