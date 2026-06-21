"use client";

/**
 * DatabaseAssetsTable — Full-width table of monitored DB assets
 *
 * Designed for **scaling**: when Bos adds 50+ databases, card grids
 * become unwieldy (scroll fatigue). This is a compact sortable table
 * matching the events table style, so the page feels consistent.
 *
 * Columns:
 *   - Status (dot + label)
 *   - Display Name (primary identifier, sortable)
 *   - Environment (badge)
 *   - DB Type
 *   - Host:Port
 *   - DB Name
 *   - Username
 *   - Events (count, links to filtered view)
 *   - Created (relative time)
 *
 * Bos: "buat full bro untuk asset ya, jangan di kasih box kayak gtu,
 *       soalnya nnti monitoring databases pasti banyak"
 *
 * Features:
 *   - Sortable columns (Status / Name / Env / Type / Events / Created)
 *   - Live search filter on this table (no need to wait for debounced URL search)
 *   - Row click → links to filtered events by hostname
 *   - Empty state with Add Asset hint
 *   - Status updates with color dots (ONLINE/OFFLINE/PENDING/ERROR)
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Database,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ExternalLink,
  Plus,
  Pencil,
  Trash2,
} from "lucide-react";
import { EditAssetModal } from "./edit-asset-modal";
import { DeleteAssetModal } from "./delete-asset-modal";

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
  createdAt: Date | string;
  role?: string | null;
  location?: string | null;
  description?: string | null;
  tags?: unknown;
  monitorAllDatabases?: boolean;
  discoveredDatabases?: string[] | null;
  lastDiscoveryAt?: Date | string | null;
  _count: { dbEvents: number };
};

type SortKey = "status" | "name" | "env" | "type" | "events" | "created";
type SortDir = "asc" | "desc";

const STATUS_STYLE: Record<
  Asset["status"],
  { dot: string; label: string; text: string }
> = {
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

const DB_TYPE_COLOR: Record<Asset["dbType"], string> = {
  POSTGRES: "text-blue-300",
  MYSQL: "text-cyan-300",
  SQLSERVER: "text-red-300",
  NONE: "text-zinc-500",
};

const ENV_BADGE: Record<string, string> = {
  PROD: "bg-red-500/10 text-red-300 border-red-500/30",
  STAGING: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  UAT: "bg-blue-500/10 text-blue-300 border-blue-500/30",
};

export function DatabaseAssetsTable({ assets }: { assets: Asset[] }) {
  const router = useRouter();
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [localSearch, setLocalSearch] = useState("");
  const [editTarget, setEditTarget] = useState<Asset | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Asset | null>(null);

  const refresh = () => router.refresh();

  // Sort + filter
  const sorted = useMemo(() => {
    const filtered = localSearch.trim()
      ? assets.filter((a) => {
          const q = localSearch.toLowerCase();
          return (
            (a.displayName ?? "").toLowerCase().includes(q) ||
            a.hostname.toLowerCase().includes(q) ||
            (a.dbHost ?? "").toLowerCase().includes(q) ||
            (a.dbName ?? "").toLowerCase().includes(q) ||
            (a.dbUser ?? "").toLowerCase().includes(q) ||
            a.dbType.toLowerCase().includes(q) ||
            a.environment.toLowerCase().includes(q)
          );
        })
      : assets;

    // Status sort order: ONLINE > PENDING > OFFLINE > ERROR
    const STATUS_ORDER: Record<Asset["status"], number> = {
      ONLINE: 0,
      PENDING: 1,
      OFFLINE: 2,
      ERROR: 3,
    };

    return [...filtered].sort((a, b) => {
      let av: string | number = "";
      let bv: string | number = "";
      switch (sortKey) {
        case "status":
          av = STATUS_ORDER[a.status];
          bv = STATUS_ORDER[b.status];
          break;
        case "name":
          av = (a.displayName ?? a.hostname).toLowerCase();
          bv = (b.displayName ?? b.hostname).toLowerCase();
          break;
        case "env":
          av = a.environment;
          bv = b.environment;
          break;
        case "type":
          av = a.dbType;
          bv = b.dbType;
          break;
        case "events":
          av = a._count.dbEvents;
          bv = b._count.dbEvents;
          break;
        case "created":
          av = new Date(a.createdAt).getTime();
          bv = new Date(b.createdAt).getTime();
          break;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [assets, sortKey, sortDir, localSearch]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const SortHeader = ({
    k,
    children,
    className,
  }: {
    k: SortKey;
    children: React.ReactNode;
    className?: string;
  }) => {
    const isActive = sortKey === k;
    const Icon = !isActive
      ? ChevronsUpDown
      : sortDir === "asc"
      ? ChevronUp
      : ChevronDown;
    return (
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className={`flex items-center gap-1 hover:text-zinc-200 transition-colors ${
          isActive ? "text-zinc-200" : "text-zinc-400"
        } ${className ?? ""}`}
      >
        {children}
        <Icon className="h-3 w-3 opacity-60" />
      </button>
    );
  };

  // Empty state
  if (assets.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-10 text-center">
        <Database
          className="h-10 w-10 text-[var(--muted-foreground)] mx-auto mb-3"
          strokeWidth={1.5}
        />
        <h3 className="text-sm font-semibold text-zinc-300">
          No database assets yet
        </h3>
        <p className="text-xs text-[var(--muted-foreground)] mt-1">
          Add your first database target to start monitoring login events.
        </p>
        <p className="text-[10px] text-zinc-600 mt-3 flex items-center justify-center gap-1">
          <Plus className="h-3 w-3" />
          Click{" "}
          <span className="font-semibold text-zinc-400">
            Add Asset
          </span>{" "}
          in the header above
        </p>
      </div>
    );
  }

  // Relative time formatter (e.g. "2h ago", "5d ago")
  const relTime = (d: Date | string): string => {
    const date = typeof d === "string" ? new Date(d) : d;
    const diff = Date.now() - date.getTime();
    const min = 60_000;
    const hr = 60 * min;
    const day = 24 * hr;
    if (diff < hr) return `${Math.floor(diff / min)}m ago`;
    if (diff < day) return `${Math.floor(diff / hr)}h ago`;
    if (diff < 30 * day) return `${Math.floor(diff / day)}d ago`;
    return date.toISOString().slice(0, 10);
  };

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      {/* Table-local search (filters just the assets, not page-wide) */}
      <div className="flex items-center justify-between gap-3 p-3 border-b border-[var(--border)]">
        <input
          type="text"
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          placeholder="Filter assets (name, host, db, user…)"
          className="flex-1 max-w-xs h-8 px-3 rounded-md bg-[var(--surface-2)] border border-[var(--border)] text-xs placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40"
        />
        <div className="text-[10px] text-[var(--muted-foreground)] font-mono">
          {sorted.length} of {assets.length}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left border-b border-[var(--border)]">
              <th className="px-3 py-2 font-medium">
                <SortHeader k="status">Status</SortHeader>
              </th>
              <th className="px-3 py-2 font-medium">
                <SortHeader k="name">Display Name</SortHeader>
              </th>
              <th className="px-3 py-2 font-medium">
                <SortHeader k="env">Env</SortHeader>
              </th>
              <th className="px-3 py-2 font-medium">
                <SortHeader k="type">Type</SortHeader>
              </th>
              <th className="px-3 py-2 font-medium text-zinc-400">
                Host : Port
              </th>
              <th className="px-3 py-2 font-medium text-zinc-400">Database</th>
              <th className="px-3 py-2 font-medium text-zinc-400">User</th>
              <th className="px-3 py-2 font-medium text-right">
                <SortHeader k="events" className="ml-auto">
                  Events
                </SortHeader>
              </th>
              <th className="px-3 py-2 font-medium">
                <SortHeader k="created">Added</SortHeader>
              </th>
              <th className="px-3 py-2 font-medium text-zinc-400 w-20 text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="px-3 py-6 text-center text-xs text-[var(--muted-foreground)]"
                >
                  No assets match "{localSearch}"
                </td>
              </tr>
            ) : (
              sorted.map((a) => {
                const status = STATUS_STYLE[a.status];
                return (
                  <tr
                    key={a.id}
                    className="border-b border-[var(--border)]/50 hover:bg-white/[0.02] transition-colors group"
                  >
                    {/* Status */}
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${status.dot}`}
                          title={status.label}
                        />
                        <span
                          className={`text-[10px] font-semibold uppercase tracking-wider ${status.text}`}
                        >
                          {status.label}
                        </span>
                      </div>
                    </td>
                    {/* Name */}
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <span
                          className="font-medium text-zinc-100 truncate max-w-[180px]"
                          title={a.displayName ?? a.hostname}
                        >
                          {a.displayName ?? a.hostname}
                        </span>
                        <Link
                          href={`/dashboard/database?q=${encodeURIComponent(
                            a.hostname
                          )}`}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                          title="View events for this asset"
                        >
                          <ExternalLink className="h-3 w-3 text-[var(--primary)]" />
                        </Link>
                      </div>
                      <div className="text-[10px] text-zinc-600 font-mono truncate max-w-[180px]">
                        {a.hostname}
                      </div>
                    </td>
                    {/* Env */}
                    <td className="px-3 py-2">
                      {ENV_BADGE[a.environment] && (
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold ${
                            ENV_BADGE[a.environment]
                          }`}
                        >
                          {a.environment}
                        </span>
                      )}
                    </td>
                    {/* Type */}
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-[11px] font-mono ${DB_TYPE_COLOR[a.dbType]}`}
                        >
                          {DB_TYPE_LABEL[a.dbType]}
                        </span>
                        {a.monitorAllDatabases && (
                          <span
                            className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 border border-violet-500/30"
                            title={`Scans all databases on server. Last discovered: ${
                              a.discoveredDatabases?.length ?? 0
                            } DB(s)${
                              a.lastDiscoveryAt
                                ? ` at ${new Date(a.lastDiscoveryAt).toLocaleString()}`
                                : " (not yet discovered)"
                            }`}
                          >
                            ALL
                          </span>
                        )}
                      </div>
                    </td>
                    {/* Host:Port */}
                    <td className="px-3 py-2 font-mono text-[11px] text-zinc-400 whitespace-nowrap">
                      {a.dbHost ? `${a.dbHost}:${a.dbPort}` : "—"}
                    </td>
                    {/* Database */}
                    <td
                      className="px-3 py-2 font-mono text-[11px] text-zinc-400 truncate max-w-[120px]"
                      title={
                        a.monitorAllDatabases && a.discoveredDatabases
                          ? `Discovered: ${a.discoveredDatabases.join(", ")}`
                          : a.dbName ?? ""
                      }
                    >
                      {a.monitorAllDatabases
                        ? `${
                            a.discoveredDatabases?.length ?? "?"
                          } DBs`
                        : a.dbName ?? "—"}
                    </td>
                    {/* User */}
                    <td
                      className="px-3 py-2 font-mono text-[11px] text-zinc-400 truncate max-w-[120px]"
                      title={a.dbUser ?? ""}
                    >
                      {a.dbUser ?? "—"}
                    </td>
                    {/* Events */}
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/dashboard/database?q=${encodeURIComponent(
                          a.hostname
                        )}`}
                        className="font-mono text-[11px] text-[var(--primary)] hover:underline"
                        title="View events for this asset"
                      >
                        {a._count.dbEvents.toLocaleString()}
                      </Link>
                    </td>
                    {/* Created */}
                    <td className="px-3 py-2 text-[10px] text-zinc-500 whitespace-nowrap">
                      {relTime(a.createdAt)}
                    </td>
                    {/* Actions */}
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditTarget(a);
                          }}
                          className="h-6 w-6 rounded flex items-center justify-center text-zinc-500 hover:text-violet-300 hover:bg-violet-500/10 transition-colors"
                          title="Edit asset metadata"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget(a);
                          }}
                          className="h-6 w-6 rounded flex items-center justify-center text-zinc-500 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                          title="Delete asset"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {editTarget && (
        <EditAssetModal
          asset={{
            id: editTarget.id,
            displayName: editTarget.displayName,
            environment: editTarget.environment,
            role: editTarget.role ?? null,
            location: editTarget.location ?? null,
            description: editTarget.description ?? null,
            tags: Array.isArray(editTarget.tags)
              ? (editTarget.tags as string[])
              : [],
            monitorAllDatabases: editTarget.monitorAllDatabases,
            discoveredDatabases: editTarget.discoveredDatabases,
          }}
          onClose={() => setEditTarget(null)}
          onUpdated={() => {
            setEditTarget(null);
            refresh();
          }}
        />
      )}

      {deleteTarget && (
        <DeleteAssetModal
          asset={{
            id: deleteTarget.id,
            displayName: deleteTarget.displayName,
            hostname: deleteTarget.hostname,
            environment: deleteTarget.environment,
            dbType: deleteTarget.dbType,
            eventCount: deleteTarget._count.dbEvents,
          }}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setDeleteTarget(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}