import { prisma } from "@/lib/db";
import { getSession } from "@/lib/security/rbac";
import { AddAssetButton } from "./_components/add-asset-button";
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

  // Counts for tabs (single query per category, small N)
  const counts = await prisma.asset.groupBy({
    by: ["category"],
    where: { userId: session.userId },
    _count: { _all: true },
  });
  const countMap: Record<string, number> = {
    SSH: 0,
    DATABASE: 0,
    APP: 0,
  };
  for (const c of counts) countMap[c.category] = c._count._all;
  const totalCount = countMap.SSH + countMap.DATABASE + countMap.APP;

  // Counts for env filter
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
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      category: true,
      environment: true,
      hostname: true,
      publicIp: true,
      privateIp: true,
      os: true,
      kernel: true,
      sshPort: true,
      sshUser: true,
      dbType: true,
      dbHost: true,
      dbPort: true,
      dbName: true,
      dbUser: true,
      status: true,
      lastSeenAt: true,
      createdAt: true,
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
    const params = new URLSearchParams();
    if (c !== "ALL") params.set("category", c);
    if (e !== "ALL") params.set("environment", e);
    const q = params.toString();
    return q ? `/dashboard/assets?${q}` : "/dashboard/assets";
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Assets</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            {totalCount} asset{totalCount !== 1 ? "s" : ""} being monitored
            {filter !== "ALL" && (
              <span className="ml-2 text-[var(--muted-foreground)]">
                · filter: {CATEGORY_META[filter]?.label}
              </span>
            )}
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
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  active
                    ? "bg-white text-black shadow-sm"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-white/[0.04]"
                }`}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={active ? 2.25 : 1.75} />
                <span>{t.label}</span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                    active
                      ? "bg-black/10 text-black/70"
                      : "bg-white/[0.04] text-[var(--muted-foreground)]"
                  }`}
                >
                  {t.count}
                </span>
              </Link>
            );
          })}
        </div>

        {/* Environment filter */}
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
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all whitespace-nowrap ${
                  active
                    ? "bg-white text-black shadow-sm"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-white/[0.04]"
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
                      ? "bg-black/10 text-black/70"
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
            {filter === "ALL"
              ? "Add your first asset to start monitoring SSH and database login events"
              : `Belum ada asset di kategori ${CATEGORY_META[filter]?.label}`}
          </p>
          <div className="mt-5">
            <AddAssetButton />
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-white/[0.02]">
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    Category
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    Env
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    Hostname
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] hidden md:table-cell">
                    IP
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] hidden lg:table-cell">
                    OS
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    {filter === "DATABASE" || filter === "ALL" ? "Database" : "SSH"}
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] hidden sm:table-cell">
                    Last seen
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
                  const dbBadge = a.dbType !== "NONE" ? DB_TYPE_BADGE[a.dbType] : null;
                  const catMeta = CATEGORY_META[a.category];
                  const CatIcon = catMeta?.icon ?? Server;
                  const envMeta = ENV_META[a.environment];
                  const EnvIcon = envMeta?.icon ?? Globe;
                  const showDbCol = filter === "ALL" || filter === "DATABASE";
                  return (
                    <tr
                      key={a.id}
                      className="border-b border-[var(--border)] last:border-0 hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Circle
                            className={`h-2 w-2 fill-current ${
                              isOnline
                                ? "text-[var(--success)]"
                                : a.status === "ERROR"
                                  ? "text-[var(--danger)]"
                                  : a.status === "PENDING"
                                    ? "text-[var(--warning)]"
                                    : "text-[var(--muted)]"
                            }`}
                          />
                          <span className="text-xs font-mono text-[var(--muted-foreground)]">
                            {a.status}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
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
                      <td className="px-4 py-3">
                        <div
                          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border"
                          style={{
                            borderColor: `${envMeta?.color}40`,
                            backgroundColor: `${envMeta?.color}10`,
                          }}
                        >
                          <EnvIcon
                            className="h-3 w-3"
                            strokeWidth={2}
                            style={{ color: envMeta?.color }}
                          />
                          <span
                            className="text-[10px] font-mono font-semibold tracking-wider"
                            style={{ color: envMeta?.color }}
                          >
                            {a.environment}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-mono text-sm font-medium">{a.hostname}</div>
                        {a.privateIp && (
                          <div className="text-[10px] text-[var(--muted-foreground)] font-mono">
                            {a.privateIp}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-[var(--muted-foreground)] hidden md:table-cell">
                        {a.publicIp || "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--muted-foreground)] hidden lg:table-cell">
                        {a.os || "—"}
                      </td>
                      <td className="px-4 py-3">
                        {showDbCol && dbBadge ? (
                          <div className="flex items-center gap-1.5 text-xs">
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ backgroundColor: dbBadge.color }}
                            />
                            <span style={{ color: dbBadge.color }} className="font-medium">
                              {dbBadge.label}
                            </span>
                            {a.dbHost && (
                              <code className="text-[10px] text-[var(--muted-foreground)] font-mono">
                                :{a.dbPort}
                              </code>
                            )}
                          </div>
                        ) : !showDbCol && a.sshUser ? (
                          <div className="flex items-center gap-1.5 text-xs">
                            <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
                            <code className="font-mono text-[var(--muted-foreground)]">
                              :{a.sshPort}
                            </code>
                          </div>
                        ) : (
                          <span className="text-xs text-[var(--muted-foreground)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--muted-foreground)] hidden sm:table-cell">
                        {minutesAgo !== null ? (
                          <span className="font-mono">{minutesAgo}m ago</span>
                        ) : (
                          <span>never</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="text-xs text-[var(--muted-foreground)]">
        <Link href="/dashboard" className="hover:text-[var(--foreground)] underline underline-offset-2">
          ← Back to overview
        </Link>
      </div>
    </div>
  );
}
