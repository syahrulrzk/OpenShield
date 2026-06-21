"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Trash2,
  PlayCircle,
  Settings,
  Clock,
  Database,
  Calendar,
  Save,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  History,
} from "lucide-react";

type Table = {
  model: string;
  label: string;
  retentionDays: number;
  total: number;
  oldest: string | null;
  expired: number;
};

type LastRun = {
  ranAt: string;
  totalDeleted: number;
  dryRun: boolean;
  highDays?: number;
  lowDays?: number;
  summary: Array<{ model: string; deleted: number; days: number }>;
};

type Data = {
  policy: { highDays: number; lowDays: number };
  tables: Table[];
  lastRuns: LastRun[];
};

function formatAge(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (days === 0 && hours === 0) return "just now";
  if (days === 0) return `${hours}h ago`;
  if (hours === 0) return `${days}d ago`;
  return `${days}d ${hours}h ago`;
}

export function CleanupAdminContent({
  initialData,
}: {
  initialData: Data;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState<"idle" | "dryrun" | "real">("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    ok: boolean;
    totalDeleted: number;
    dryRun: boolean;
    summary: any[];
  } | null>(null);

  // Editable policy fields
  const [highDays, setHighDays] = useState(initialData.policy.highDays);
  const [lowDays, setLowDays] = useState(initialData.policy.lowDays);
  const [policyDirty, setPolicyDirty] = useState(false);

  const triggerCleanup = async (dryRun: boolean) => {
    setRunning(dryRun ? "dryrun" : "real");
    setError(null);
    try {
      const res = await fetch("/api/admin/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? data.stderr ?? "Cleanup failed");
        return;
      }
      setLastResult({
        ok: true,
        totalDeleted: data.summary?.totalDeleted ?? 0,
        dryRun,
        summary: data.summary?.summary ?? [],
      });
      // Refresh server data after real cleanup
      if (!dryRun) {
        startTransition(() => router.refresh());
      }
    } catch (err: any) {
      setError(err.message ?? "Network error");
    } finally {
      setRunning("idle");
    }
  };

  const savePolicy = async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/cleanup", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ highDays, lowDays }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? data.error ?? "Save failed");
        return;
      }
      setPolicyDirty(false);
      startTransition(() => router.refresh());
    } catch (err: any) {
      setError(err.message ?? "Network error");
    }
  };

  const refresh = () => {
    startTransition(() => router.refresh());
  };

  return (
    <div className="space-y-6">
      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-300">
          <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Policy editor */}
      <section className="bg-slate-900/40 border border-slate-800 rounded-lg p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
              <Settings className="h-5 w-5 text-slate-400" />
              Retention Policy
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              Low-retention tables (FIM, Syslog, Auditd) hold operational data
              with short audit value. High-retention tables (Server Auth, Apps,
              Database) keep security-relevant records longer.
            </p>
          </div>
          <button
            onClick={refresh}
            disabled={isPending}
            className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw
              className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`}
            />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">
              Low Retention (days)
            </label>
            <input
              type="number"
              min={1}
              max={365}
              value={lowDays}
              onChange={(e) => {
                setLowDays(parseInt(e.target.value) || 1);
                setPolicyDirty(true);
              }}
              className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-md text-sm text-slate-200 font-mono"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Applies to: syslog, fim, auditd
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">
              High Retention (days)
            </label>
            <input
              type="number"
              min={1}
              max={365}
              value={highDays}
              onChange={(e) => {
                setHighDays(parseInt(e.target.value) || 1);
                setPolicyDirty(true);
              }}
              className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-md text-sm text-slate-200 font-mono"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Applies to: server_auth, apps, database
            </p>
          </div>
        </div>

        {lowDays > highDays && (
          <div className="mt-3 flex items-center gap-2 text-xs text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            Low retention must be ≤ high retention
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={savePolicy}
            disabled={
              !policyDirty ||
              lowDays < 1 ||
              highDays < 1 ||
              lowDays > highDays ||
              isPending
            }
            className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-md text-sm font-medium flex items-center gap-2"
          >
            <Save className="h-4 w-4" />
            Save policy
          </button>
          {policyDirty && (
            <span className="text-xs text-amber-400">Unsaved changes</span>
          )}
        </div>
      </section>

      {/* Action buttons */}
      <section className="bg-slate-900/40 border border-slate-800 rounded-lg p-5">
        <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2 mb-4">
          <PlayCircle className="h-5 w-5 text-slate-400" />
          Trigger Cleanup
        </h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => triggerCleanup(true)}
            disabled={running !== "idle"}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white rounded-md text-sm font-medium flex items-center gap-2"
          >
            <PlayCircle className="h-4 w-4" />
            {running === "dryrun" ? "Running…" : "Dry-run"}
          </button>
          <button
            onClick={() => triggerCleanup(false)}
            disabled={running !== "idle"}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-md text-sm font-medium flex items-center gap-2"
          >
            <Trash2 className="h-4 w-4" />
            {running === "real" ? "Running…" : "Run cleanup now"}
          </button>
        </div>

        {lastResult && (
          <div
            className={`mt-4 p-3 rounded-lg border ${
              lastResult.dryRun
                ? "bg-slate-800/50 border-slate-700"
                : lastResult.totalDeleted > 0
                  ? "bg-amber-500/10 border-amber-500/30"
                  : "bg-emerald-500/10 border-emerald-500/30"
            }`}
          >
            <div className="flex items-center gap-2 text-sm">
              {lastResult.dryRun ? (
                <Clock className="h-4 w-4 text-slate-400" />
              ) : lastResult.totalDeleted > 0 ? (
                <Trash2 className="h-4 w-4 text-amber-400" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              )}
              <span className="font-medium text-slate-100">
                {lastResult.dryRun
                  ? `Dry-run: would delete ${lastResult.totalDeleted} rows`
                  : `Deleted ${lastResult.totalDeleted} rows`}
              </span>
            </div>
            {lastResult.summary.filter((s: any) => s.deleted > 0).length > 0 && (
              <ul className="mt-2 text-xs text-slate-400 space-y-0.5 font-mono">
                {lastResult.summary
                  .filter((s: any) => s.deleted > 0)
                  .map((s: any) => (
                    <li key={s.model}>
                      {s.model}: {s.deleted} rows (older than {s.days}d)
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* Per-table breakdown */}
      <section className="bg-slate-900/40 border border-slate-800 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800">
          <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <Database className="h-5 w-5 text-slate-400" />
            Table Inventory
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Current row counts, oldest event, and rows that would be deleted at
            next cleanup.
          </p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-950/50">
            <tr className="text-left text-xs text-slate-400 uppercase tracking-wide">
              <th className="px-5 py-2 font-medium">Table</th>
              <th className="px-5 py-2 font-medium">Retention</th>
              <th className="px-5 py-2 font-medium text-right">Total rows</th>
              <th className="px-5 py-2 font-medium">Oldest</th>
              <th className="px-5 py-2 font-medium text-right">
                Would delete
              </th>
            </tr>
          </thead>
          <tbody>
            {initialData.tables.map((t) => (
              <tr
                key={t.model}
                className="border-t border-slate-800 hover:bg-slate-800/30"
              >
                <td className="px-5 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-slate-200">{t.label}</span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {t.model}
                    </span>
                  </div>
                </td>
                <td className="px-5 py-2.5">
                  <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-slate-800 text-slate-300">
                    {t.retentionDays}d
                  </span>
                </td>
                <td className="px-5 py-2.5 text-right font-mono text-slate-200">
                  {t.total.toLocaleString()}
                </td>
                <td className="px-5 py-2.5 text-xs text-slate-400">
                  {t.oldest ? formatAge(t.oldest) : "—"}
                </td>
                <td className="px-5 py-2.5 text-right font-mono">
                  {t.expired > 0 ? (
                    <span className="text-amber-400">{t.expired}</span>
                  ) : (
                    <span className="text-slate-600">0</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Cleanup history */}
      <section className="bg-slate-900/40 border border-slate-800 rounded-lg p-5">
        <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2 mb-4">
          <History className="h-5 w-5 text-slate-400" />
          Recent Cleanup Runs
        </h2>
        {initialData.lastRuns.length === 0 ? (
          <p className="text-sm text-slate-500">No cleanup runs recorded yet.</p>
        ) : (
          <ul className="space-y-3">
            {initialData.lastRuns.map((run, i) => (
              <li
                key={i}
                className="flex items-start justify-between gap-4 text-sm border-t border-slate-800 pt-3 first:border-t-0 first:pt-0"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <Calendar className="h-3.5 w-3.5 text-slate-500" />
                    <span className="text-slate-200 font-mono">
                      {new Date(run.ranAt).toLocaleString()}
                    </span>
                    {run.dryRun && (
                      <span className="px-1.5 py-0.5 text-[10px] rounded bg-slate-700 text-slate-300">
                        DRY-RUN
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 mt-1 font-mono">
                    {run.highDays ? `high=${run.highDays}d` : ""}
                    {run.lowDays ? ` low=${run.lowDays}d` : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className={`font-mono ${
                      run.totalDeleted > 0 ? "text-amber-400" : "text-slate-500"
                    }`}
                  >
                    {run.totalDeleted} rows
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="text-[11px] text-slate-600 italic">
        Cleanup script: <span className="font-mono">scripts/cleanup-event-logs.mjs</span>
        {" • "}
        Timer: <span className="font-mono">openshield-cleanup.timer</span>
      </div>
    </div>
  );
}