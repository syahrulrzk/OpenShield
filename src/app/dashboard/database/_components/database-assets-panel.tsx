"use client";

/**
 * DatabaseAssetsPanel — Card grid of monitored DB assets
 *
 * Renders one card per Asset with:
 *   - Status dot (ONLINE/OFFLINE/ERROR/PENDING)
 *   - Display name + env badge
 *   - DB type badge (PG/MySQL/MSSQL)
 *   - Host:port + dbname + dbuser (subtle mono text)
 *   - Event count (link, filtered by asset hostname)
 *   - "View events" link (filtered by hostname, fast filter)
 *
 * If 0 assets: shows empty state with "Add Asset" hint pointing to header button.
 */

import Link from "next/link";
import { Database, Server, Activity, Plus, ChevronRight } from "lucide-react";

type Asset = {
  id: string;
  displayName: string | null;
  hostname: string;
  environment: string;
  dbType: "POSTGRES" | "MYSQL" | "SQLSERVER" | "NONE";
  dbHost: string | null;
  dbPort: number | null;
  dbName: string | null;
  dbUser: string | null;
  status: "PENDING" | "ONLINE" | "OFFLINE" | "ERROR";
  createdAt: Date;
  _count: { dbEvents: number };
};

const STATUS_STYLE: Record<Asset["status"], { dot: string; label: string; text: string }> = {
  ONLINE: { dot: "bg-[var(--success)]", label: "Online", text: "text-[var(--success)]" },
  OFFLINE: { dot: "bg-zinc-500", label: "Offline", text: "text-zinc-400" },
  PENDING: { dot: "bg-[var(--warning)]", label: "Pending", text: "text-[var(--warning)]" },
  ERROR: { dot: "bg-[var(--danger)]", label: "Error", text: "text-[var(--danger)]" },
};

const DB_TYPE_LABEL: Record<Asset["dbType"], string> = {
  POSTGRES: "PostgreSQL",
  MYSQL: "MySQL",
  SQLSERVER: "SQL Server",
  NONE: "None",
};

const ENV_STYLE: Record<string, string> = {
  PROD: "bg-red-500/10 text-red-300 border-red-500/30",
  STAGING: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  UAT: "bg-blue-500/10 text-blue-300 border-blue-500/30",
};

export function DatabaseAssetsPanel({ assets }: { assets: Asset[] }) {
  if (assets.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center">
        <Database className="h-8 w-8 text-[var(--muted-foreground)] mx-auto mb-3" strokeWidth={1.5} />
        <h3 className="text-sm font-semibold text-zinc-300">No database assets yet</h3>
        <p className="text-xs text-[var(--muted-foreground)] mt-1">
          Add your first database target to start monitoring login events.
        </p>
        <p className="text-[10px] text-zinc-600 mt-3 flex items-center justify-center gap-1">
          <Plus className="h-3 w-3" />
          Click <span className="font-semibold text-zinc-400">Add Asset</span> in the header above
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <Server className="h-3.5 w-3.5 text-[var(--primary)]" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
            Monitored Assets
          </h2>
          <span className="text-[10px] text-zinc-600 font-mono">{assets.length}</span>
        </div>
        <Link
          href="/dashboard/database"
          className="text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
        >
          Refresh ↻
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 p-2">
        {assets.map((a) => {
          const status = STATUS_STYLE[a.status];
          return (
            <div
              key={a.id}
              className="group rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 hover:border-[var(--primary)]/30 transition-colors"
            >
              {/* Row 1: status + env badge */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
                  <span className={`text-[10px] font-semibold uppercase tracking-wider ${status.text}`}>
                    {status.label}
                  </span>
                </div>
                {ENV_STYLE[a.environment] && (
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold ${
                      ENV_STYLE[a.environment]
                    }`}
                  >
                    {a.environment}
                  </span>
                )}
              </div>

              {/* Row 2: name + DB type */}
              <div className="flex items-baseline justify-between mb-2">
                <h3 className="text-sm font-semibold text-zinc-100 truncate" title={a.displayName ?? a.hostname}>
                  {a.displayName ?? a.hostname}
                </h3>
                <span className="text-[9px] text-[var(--muted-foreground)] font-mono shrink-0 ml-2">
                  {DB_TYPE_LABEL[a.dbType]}
                </span>
              </div>

              {/* Row 3: connection info */}
              <div className="space-y-0.5 text-[10px] font-mono text-zinc-500">
                {a.dbHost && (
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="text-zinc-600">host:</span>
                    <span className="text-zinc-400 truncate" title={`${a.dbHost}:${a.dbPort}`}>
                      {a.dbHost}:{a.dbPort}
                    </span>
                  </div>
                )}
                {a.dbName && (
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="text-zinc-600">db:</span>
                    <span className="text-zinc-400 truncate" title={a.dbName}>
                      {a.dbName}
                    </span>
                  </div>
                )}
                {a.dbUser && (
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="text-zinc-600">user:</span>
                    <span className="text-zinc-400 truncate" title={a.dbUser}>
                      {a.dbUser}
                    </span>
                  </div>
                )}
              </div>

              {/* Row 4: event count + filter link */}
              <div className="mt-3 pt-2 border-t border-[var(--border)] flex items-center justify-between">
                <div className="flex items-center gap-1 text-[10px] text-[var(--muted-foreground)]">
                  <Activity className="h-3 w-3" />
                  <span className="font-mono">{a._count.dbEvents.toLocaleString()}</span>
                  <span>events</span>
                </div>
                <Link
                  href={`/dashboard/database?q=${encodeURIComponent(a.hostname)}`}
                  className="text-[10px] text-[var(--primary)] hover:underline flex items-center gap-0.5"
                >
                  View
                  <ChevronRight className="h-2.5 w-2.5" />
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}