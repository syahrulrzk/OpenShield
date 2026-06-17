import { prisma } from "@/lib/db";
import { getSession } from "@/lib/security/rbac";
import { CheckCircle2, XCircle, Database, ShieldOff, Clock, Search, X } from "lucide-react";
import { subHours, subDays } from "date-fns";
import Link from "next/link";
import type { AssetCategory, DbType, DbEventStatus } from "@prisma/client";
import { FilterDropdown, type DropdownOption } from "@/components/filter-dropdown";

const DB_TYPE_BADGE: Record<DbType, { label: string; color: string }> = {
  POSTGRES: { label: "Postgres", color: "#336791" },
  MYSQL: { label: "MySQL", color: "#00758f" },
  SQLSERVER: { label: "SQL Server", color: "#cc2927" },
  NONE: { label: "None", color: "#71717a" },
};

const ENV_META: Record<string, { label: string; color: string }> = {
  PROD: { label: "Production", color: "#ef4444" },
  STAGING: { label: "Staging", color: "#f97316" },
  UAT: { label: "UAT", color: "#3b82f6" },
  DEV: { label: "Development", color: "#10b981" },
  DR: { label: "DR", color: "#a855f7" },
};

type Search = { range?: string; status?: string; dbType?: string; q?: string; env?: string };

export default async function DatabaseEventsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await getSession();
  if (!session) return null;
  const sp = await searchParams;

  const range = sp.range || "24h";
  const since =
    range === "1h" ? subHours(new Date(), 1) :
    range === "7d" ? subDays(new Date(), 7) :
    subDays(new Date(), 1);

  const dbTypeFilter =
    sp.dbType && ["POSTGRES", "MYSQL", "SQLSERVER"].includes(sp.dbType)
      ? (sp.dbType as DbType)
      : undefined;

  const statusFilter =
    sp.status === "success"
      ? "SUCCESS"
      : sp.status === "failed"
        ? "FAILED"
        : sp.status === "denied"
          ? "DENIED"
          : undefined;

  const envFilter = sp.env && ["PROD", "STAGING", "UAT", "DEV", "DR"].includes(sp.env) ? sp.env : undefined;

  // Build search OR clause
  const q = sp.q?.trim();
  const searchOr = q
    ? {
        OR: [
          { username: { contains: q, mode: "insensitive" as const } },
          { sourceIp: { contains: q, mode: "insensitive" as const } },
          { asset: { hostname: { contains: q, mode: "insensitive" as const } } },
        ],
      }
    : {};

  const where: any = {
    asset: {
      userId: session.userId,
      category: "DATABASE" as AssetCategory,
      ...(envFilter ? { environment: envFilter } : {}),
    },
    eventTime: { gte: since },
    ...searchOr,
  };
  if (statusFilter) where.status = statusFilter;
  if (dbTypeFilter) where.dbType = dbTypeFilter;

  const baseWhere = {
    asset: { userId: session.userId, category: "DATABASE" as AssetCategory },
    eventTime: { gte: since },
  };
  const [events, total, successCount, failedCount, deniedCount, dbTypeCounts, envCounts] =
    await Promise.all([
      prisma.dbEvent.findMany({
        where,
        orderBy: { eventTime: "desc" },
        take: 100,
        select: {
          id: true,
          dbType: true,
          username: true,
          sourceIp: true,
          database: true,
          status: true,
          eventTime: true,
          asset: { select: { hostname: true, environment: true } },
        },
      }),
      prisma.dbEvent.count({ where: baseWhere }),
      prisma.dbEvent.count({ where: { ...baseWhere, status: "SUCCESS" } }),
      prisma.dbEvent.count({ where: { ...baseWhere, status: "FAILED" } }),
      prisma.dbEvent.count({ where: { ...baseWhere, status: "DENIED" } }),
      prisma.dbEvent.groupBy({
        by: ["dbType"],
        where: baseWhere,
        _count: { _all: true },
      }),
      prisma.asset.groupBy({
        by: ["environment"],
        where: { userId: session.userId, category: "DATABASE" },
        _count: { _all: true },
      }),
    ]);

  const dbTypeMap: Record<string, number> = {};
  for (const c of dbTypeCounts) dbTypeMap[c.dbType] = c._count._all;
  const envCountMap: Record<string, number> = { PROD: 0, STAGING: 0, UAT: 0, DEV: 0, DR: 0 };
  for (const c of envCounts) envCountMap[c.environment] = c._count._all;

  function buildHref(overrides: Partial<Search>) {
    const merged: Search = { range, ...sp, ...overrides };
    const params = new URLSearchParams();
    if (merged.range && merged.range !== "24h") params.set("range", merged.range);
    if (merged.status && merged.status !== "all") params.set("status", merged.status);
    if (merged.dbType) params.set("dbType", merged.dbType);
    if (merged.q) params.set("q", merged.q);
    if (merged.env) params.set("env", merged.env);
    const q = params.toString();
    return q ? `/dashboard/events/database?${q}` : "/dashboard/events/database";
  }

  const rangeOptions: DropdownOption[] = [
    { value: "1h", label: "Last 1 hour", shortLabel: "1h" },
    { value: "24h", label: "Last 24 hours", shortLabel: "24h" },
    { value: "7d", label: "Last 7 days", shortLabel: "7d" },
  ];

  const statusOptions: DropdownOption[] = [
    { value: "all", label: "All status", shortLabel: "All", count: total },
    { value: "success", label: "Success", shortLabel: "Success", count: successCount, color: "#10b981", dot: true },
    { value: "failed", label: "Failed", shortLabel: "Failed", count: failedCount, color: "#ef4444", dot: true },
    { value: "denied", label: "Denied", shortLabel: "Denied", count: deniedCount, color: "#f59e0b", dot: true },
  ];

  const dbTypeOptions: DropdownOption[] = [
    { value: "", label: "All DB types", shortLabel: "All", count: Object.values(dbTypeMap).reduce((a, b) => a + b, 0) },
    ...(["POSTGRES", "MYSQL", "SQLSERVER"] as const).map((t) => ({
      value: t,
      label: DB_TYPE_BADGE[t].label,
      shortLabel: DB_TYPE_BADGE[t].label,
      count: dbTypeMap[t] || 0,
      color: DB_TYPE_BADGE[t].color,
      dot: true,
    })),
  ];
  const envOptions: DropdownOption[] = [
    { value: "", label: "All environments", shortLabel: "All", count: Object.values(envCountMap).reduce((a, b) => a + b, 0) },
    ...Object.entries(envCountMap).map(([env, count]) => ({
      value: env,
      label: env,
      shortLabel: env,
      count,
      color: ENV_META[env]?.color,
      dot: true,
    })),
  ];

  function buildCurrentParams() {
    return {
      range: range !== "24h" ? range : undefined,
      status: sp.status && sp.status !== "all" ? sp.status : undefined,
      dbType: sp.dbType || undefined,
      q: sp.q || undefined,
      env: sp.env || undefined,
    };
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Database Events
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Login attempts across all monitored databases
          </p>
        </div>
        <Link
          href="/dashboard/events"
          className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
        >
          ← SSH Events
        </Link>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] font-semibold">Total</div>
          <div className="mt-1 text-2xl font-semibold font-mono">{total}</div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] font-semibold flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" /> Success
          </div>
          <div className="mt-1 text-2xl font-semibold font-mono text-[var(--success)]">{successCount}</div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] font-semibold flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--danger)]" /> Failed
          </div>
          <div className="mt-1 text-2xl font-semibold font-mono text-[var(--danger)]">{failedCount}</div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] font-semibold flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--warning)]" /> Denied
          </div>
          <div className="mt-1 text-2xl font-semibold font-mono text-[var(--warning)]">{deniedCount}</div>
        </div>
      </div>

      {/* Filters — single row (wraps on mobile) */}
      <div className="flex flex-wrap items-center gap-2">
        <form action="/dashboard/events/database" method="get" className="flex-1 min-w-[180px] flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)] pointer-events-none" />
            <input
              type="text"
              name="q"
              defaultValue={sp.q || ""}
              placeholder="Search user, IP, or server…"
              className="w-full h-9 pl-9 pr-9 text-sm rounded-lg border border-[var(--border)] bg-[var(--surface)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/30 font-mono placeholder:text-[var(--muted-foreground)]/60"
            />
            {sp.q && (
              <Link
                href={`/dashboard/events/database${(() => {
                  const p = new URLSearchParams();
                  if (sp.range && sp.range !== "24h") p.set("range", sp.range);
                  if (sp.status && sp.status !== "all") p.set("status", sp.status);
                  if (sp.dbType) p.set("dbType", sp.dbType);
                  if (sp.env) p.set("env", sp.env);
                  const q = p.toString();
                  return q ? `?${q}` : "";
                })()}`}
                scroll={false}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 rounded flex items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-white/[0.06]"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
          {sp.range && sp.range !== "24h" && <input type="hidden" name="range" value={sp.range} />}
          {sp.status && sp.status !== "all" && <input type="hidden" name="status" value={sp.status} />}
          {sp.dbType && <input type="hidden" name="dbType" value={sp.dbType} />}
          {sp.env && <input type="hidden" name="env" value={sp.env} />}
        </form>
        <FilterDropdown
          label="Time"
          value={range}
          options={rangeOptions}
          paramName="range"
          currentParams={buildCurrentParams()}
        />
        <FilterDropdown
          label="Status"
          value={sp.status || "all"}
          options={statusOptions}
          paramName="status"
          currentParams={buildCurrentParams()}
        />
        <FilterDropdown
          label="Type"
          value={sp.dbType || ""}
          options={dbTypeOptions}
          paramName="dbType"
          currentParams={buildCurrentParams()}
        />
        <FilterDropdown
          label="Env"
          value={sp.env || ""}
          options={envOptions}
          paramName="env"
          currentParams={buildCurrentParams()}
        />
        {(q || envFilter || statusFilter || dbTypeFilter) && (
          <Link
            href="/dashboard/events/database"
            scroll={false}
            className="h-9 px-2.5 rounded-lg text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-white/[0.04] flex items-center gap-1.5"
          >
            <X className="h-3 w-3" />
            Clear
          </Link>
        )}
      </div>

      {/* Events table */}
      {events.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-[var(--border-strong)] p-12 text-center">
          <Database className="h-10 w-10 text-[var(--muted-foreground)] mx-auto" strokeWidth={1.5} />
          <h3 className="mt-4 text-sm font-semibold">
            {q ? `No events match "${q}"` : "No database events"}
          </h3>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            {q ? "Coba kata kunci lain atau clear filters" : "Belum ada DB login events di range ini. Add database asset & tunggu collector polling."}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-[var(--border)] bg-white/[0.02]">
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Status</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Time</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Asset</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Env</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">DB</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Username</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] hidden md:table-cell">Database</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] hidden md:table-cell">Source IP</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => {
                  const meta = DB_TYPE_BADGE[e.dbType];
                  const eMeta = ENV_META[e.asset.environment];
                  return (
                    <tr key={e.id} className="border-b border-[var(--border)] last:border-0 hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3">
                        {e.status === "SUCCESS" ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--success)]">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Success
                          </span>
                        ) : e.status === "FAILED" ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--danger)]">
                            <XCircle className="h-3.5 w-3.5" /> Failed
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--warning)]">
                            <ShieldOff className="h-3.5 w-3.5" /> Denied
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-[var(--muted-foreground)] whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3 w-3 opacity-50" />
                          {new Date(e.eventTime).toLocaleString("id-ID", {
                            day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono font-medium">{e.asset.hostname}</td>
                      <td className="px-4 py-3">
                        {eMeta && (
                          <span
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold tracking-wider"
                            style={{
                              color: eMeta.color,
                              backgroundColor: `${eMeta.color}15`,
                              border: `1px solid ${eMeta.color}40`,
                            }}
                          >
                            {e.asset.environment}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {meta && (
                          <div className="flex items-center gap-1.5 text-xs">
                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
                            <span className="font-medium" style={{ color: meta.color }}>{meta.label}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono">{e.username}</td>
                      <td className="px-4 py-3 text-xs font-mono text-[var(--muted-foreground)] hidden md:table-cell">{e.database || "—"}</td>
                      <td className="px-4 py-3 text-xs font-mono text-[var(--muted-foreground)] hidden md:table-cell">{e.sourceIp || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {events.length > 0 && (
        <div className="text-[10px] text-[var(--muted-foreground)] font-mono">
          Showing {events.length} of {total} events
          {q && <span className="ml-2 text-[var(--accent)]">· search: "{q}"</span>}
          {envFilter && <span className="ml-2 text-[var(--accent)]">· env: {envFilter}</span>}
        </div>
      )}
    </div>
  );
}
