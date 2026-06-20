"use client";

import { useState, useTransition, useMemo } from "react";

type AuditRow = {
  id: string;
  createdAt: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  userId: string | null;
  user: { id: string; email: string | null; name: string | null } | null;
  ip: string | null;
  userAgent: string | null;
  metadata: unknown;
  prevHash: string | null;
  hash: string;
};

type PageData = {
  rows: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type ChainIntegrity = { valid: boolean; brokenAt?: string } | null;

export function AuditContent({
  initialData,
  chainIntegrity,
  knownActions,
}: {
  initialData: PageData;
  chainIntegrity: ChainIntegrity;
  knownActions: string[];
}) {
  const [isPending, startTransition] = useTransition();
  const [data, setData] = useState<PageData>(initialData);
  const [filters, setFilters] = useState({
    action: "",
    userId: "",
    resourceType: "",
    since: "",
    until: "",
    search: "",
  });
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", String(data.pageSize));
    if (filters.action) params.set("action", filters.action);
    if (filters.userId) params.set("userId", filters.userId);
    if (filters.resourceType) params.set("resourceType", filters.resourceType);
    if (filters.since) params.set("since", filters.since);
    if (filters.until) params.set("until", filters.until);
    if (filters.search) params.set("search", filters.search);
    return params.toString();
  }, [page, data.pageSize, filters]);

  async function refreshData() {
    const res = await fetch(`/api/audit?${queryString}`);
    const json = await res.json();
    setData(json);
  }

  function applyFilters() {
    setPage(1);
    startTransition(async () => {
      await refreshData();
    });
  }

  function clearFilters() {
    setFilters({
      action: "",
      userId: "",
      resourceType: "",
      since: "",
      until: "",
      search: "",
    });
    setPage(1);
    startTransition(async () => {
      await refreshData();
    });
  }

  function exportCSV() {
    const headers = [
      "createdAt",
      "action",
      "resourceType",
      "resourceId",
      "userId",
      "userEmail",
      "ip",
      "hash",
      "prevHash",
    ];
    const csvRows = [
      headers.join(","),
      ...data.rows.map((r) =>
        [
          r.createdAt,
          r.action,
          r.resourceType ?? "",
          r.resourceId ?? "",
          r.userId ?? "",
          r.user?.email ?? "",
          r.ip ?? "",
          r.hash,
          r.prevHash ?? "",
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(",")
      ),
    ];
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[:.]/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <ChainBadge data={chainIntegrity} />

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <FilterInput
            label="Search"
            value={filters.search}
            onChange={(v) => setFilters({ ...filters, search: v })}
            placeholder="action contains..."
          />
          <FilterSelect
            label="Action"
            value={filters.action}
            onChange={(v) => setFilters({ ...filters, action: v })}
            options={knownActions}
            placeholder="(any)"
          />
          <FilterInput
            label="User ID"
            value={filters.userId}
            onChange={(v) => setFilters({ ...filters, userId: v })}
            placeholder="cmq..."
          />
          <FilterInput
            label="Resource Type"
            value={filters.resourceType}
            onChange={(v) => setFilters({ ...filters, resourceType: v })}
            placeholder="agent, user..."
          />
          <FilterInput
            label="Since"
            type="datetime-local"
            value={filters.since}
            onChange={(v) => setFilters({ ...filters, since: v })}
          />
          <FilterInput
            label="Until"
            type="datetime-local"
            value={filters.until}
            onChange={(v) => setFilters({ ...filters, until: v })}
          />
        </div>
        <div className="flex justify-end gap-2 mt-3">
          <button
            type="button"
            onClick={clearFilters}
            disabled={isPending}
            className="px-3 py-1.5 text-xs rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={applyFilters}
            disabled={isPending}
            className="px-3 py-1.5 text-xs rounded-lg border border-sky-600 bg-sky-600 text-white hover:bg-sky-500 disabled:opacity-50 flex items-center gap-1.5"
          >
            {isPending ? "Loading..." : "Apply Filters"}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs text-zinc-400">
          Showing{" "}
          {data.rows.length === 0 ? 0 : (data.page - 1) * data.pageSize + 1}
          –{(data.page - 1) * data.pageSize + data.rows.length} of{" "}
          <strong className="text-zinc-200">
            {data.total.toLocaleString()}
          </strong>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setPage(1);
              startTransition(refreshData);
            }}
            disabled={isPending}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
          >
            ↻ Refresh
          </button>
          <button
            type="button"
            onClick={exportCSV}
            disabled={data.rows.length === 0}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
          >
            ⬇ Export CSV
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/80">
                <th className="text-left px-3 py-2 font-medium text-zinc-400">Time</th>
                <th className="text-left px-3 py-2 font-medium text-zinc-400">Action</th>
                <th className="text-left px-3 py-2 font-medium text-zinc-400">User</th>
                <th className="text-left px-3 py-2 font-medium text-zinc-400">Resource</th>
                <th className="text-left px-3 py-2 font-medium text-zinc-400">IP</th>
                <th className="text-left px-3 py-2 font-medium text-zinc-400">Hash</th>
                <th className="text-left px-3 py-2 font-medium text-zinc-400 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-zinc-500">
                    No audit log entries match the current filters
                  </td>
                </tr>
              )}
              {data.rows.map((row) => (
                <AuditRowItem
                  key={row.id}
                  row={row}
                  expanded={expandedId === row.id}
                  onToggle={() =>
                    setExpandedId(expandedId === row.id ? null : row.id)
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            type="button"
            onClick={() => {
              setPage(Math.max(1, page - 1));
              startTransition(refreshData);
            }}
            disabled={page === 1 || isPending}
            className="px-3 py-1.5 text-xs rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30"
          >
            ← Prev
          </button>
          <span className="text-xs text-zinc-400 px-3">
            Page {data.page} of {data.totalPages}
          </span>
          <button
            type="button"
            onClick={() => {
              setPage(Math.min(data.totalPages, page + 1));
              startTransition(refreshData);
            }}
            disabled={page >= data.totalPages || isPending}
            className="px-3 py-1.5 text-xs rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

function ChainBadge({ data }: { data: ChainIntegrity }) {
  if (!data) return null;
  if (data.valid) {
    return (
      <div className="rounded-lg border border-emerald-700 bg-emerald-950/30 px-3 py-2 flex items-center gap-2 text-xs">
        <span className="text-emerald-400">✓</span>
        <span className="text-emerald-200">
          Hash chain integrity <strong>INTACT</strong> — every audit entry
          cryptographically links to the previous one
        </span>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-amber-700 bg-amber-950/30 px-3 py-2 flex items-center gap-2 text-xs">
      <span className="text-amber-400">⚠</span>
      <span className="text-amber-200">
        Hash chain integrity <strong>BROKEN</strong> at row{" "}
        <code className="px-1.5 py-0.5 rounded bg-zinc-800 font-mono text-[11px]">
          {data.brokenAt?.slice(0, 16) ?? "unknown"}...
        </code>{" "}
        — entries after this point may have been tampered with or imported from a backup
      </span>
    </div>
  );
}

function AuditRowItem({ row, expanded, onToggle }: { row: AuditRow; expanded: boolean; onToggle: () => void }) {
  const actionColor = getActionColor(row.action);
  return (
    <>
      <tr
        className="border-b border-zinc-800/60 hover:bg-zinc-800/30 cursor-pointer"
        onClick={onToggle}
      >
        <td className="px-3 py-2 font-mono text-zinc-400 whitespace-nowrap">
          {new Date(row.createdAt).toLocaleString("id-ID", {
            hour12: false,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </td>
        <td className="px-3 py-2">
          <span className={`px-1.5 py-0.5 rounded font-mono text-[11px] ${actionColor}`}>
            {row.action}
          </span>
        </td>
        <td className="px-3 py-2 text-zinc-300">
          {row.user?.email ? (
            <span className="text-zinc-200">{row.user.email}</span>
          ) : row.userId ? (
            <span className="font-mono text-[11px] text-zinc-500">{row.userId.slice(0, 12)}…</span>
          ) : (
            <span className="text-zinc-600">—</span>
          )}
        </td>
        <td className="px-3 py-2 text-zinc-400">
          {row.resourceType ? (
            <span className="text-zinc-300">{row.resourceType}</span>
          ) : (
            <span className="text-zinc-600">—</span>
          )}
          {row.resourceId && (
            <span className="ml-1 font-mono text-[10px] text-zinc-500">
              {row.resourceId.slice(0, 8)}
            </span>
          )}
        </td>
        <td className="px-3 py-2 font-mono text-[11px] text-zinc-400">
          {row.ip ?? <span className="text-zinc-600">—</span>}
        </td>
        <td className="px-3 py-2 font-mono text-[10px] text-zinc-500">
          {row.hash.slice(0, 8)}…
        </td>
        <td className="px-3 py-2 text-zinc-500">{expanded ? "▾" : "▸"}</td>
      </tr>
      {expanded && (
        <tr className="border-b border-zinc-800/60 bg-zinc-950/40">
          <td colSpan={7} className="px-3 py-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-zinc-500 mb-1">Full hash</div>
                <code className="block px-2 py-1.5 rounded bg-zinc-900 border border-zinc-800 font-mono text-[11px] text-zinc-300 break-all">
                  {row.hash}
                </code>
              </div>
              <div>
                <div className="text-zinc-500 mb-1">Previous hash</div>
                <code className="block px-2 py-1.5 rounded bg-zinc-900 border border-zinc-800 font-mono text-[11px] text-zinc-300 break-all">
                  {row.prevHash ?? "(genesis)"}
                </code>
              </div>
              {row.userAgent && (
                <div className="md:col-span-2">
                  <div className="text-zinc-500 mb-1">User Agent</div>
                  <code className="block px-2 py-1.5 rounded bg-zinc-900 border border-zinc-800 font-mono text-[11px] text-zinc-300 break-all">
                    {row.userAgent}
                  </code>
                </div>
              )}
              {row.metadata !== null && row.metadata !== undefined && (
                <div className="md:col-span-2">
                  <div className="text-zinc-500 mb-1">Metadata</div>
                  <pre className="px-2 py-1.5 rounded bg-zinc-900 border border-zinc-800 font-mono text-[11px] text-zinc-300 overflow-x-auto">
                    {JSON.stringify(row.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function FilterInput({ label, value, onChange, placeholder, type = "text" }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wide text-zinc-500 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded text-xs text-zinc-100 focus:outline-none focus:border-zinc-600"
      />
    </div>
  );
}

function FilterSelect({ label, value, onChange, options, placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wide text-zinc-500 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded text-xs text-zinc-100 focus:outline-none focus:border-zinc-600"
      >
        <option value="">{placeholder ?? "(any)"}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </div>
  );
}

function getActionColor(action: string): string {
  if (action.startsWith("auth.")) return "bg-sky-950/50 text-sky-300 border border-sky-800/50";
  if (action.startsWith("agent.")) return "bg-violet-950/50 text-violet-300 border border-violet-800/50";
  if (action.startsWith("events.")) return "bg-rose-950/50 text-rose-300 border border-rose-800/50";
  if (action.includes("delete") || action.includes("cleared")) return "bg-rose-950/50 text-rose-300 border border-rose-800/50";
  if (action.includes("create") || action.includes("register")) return "bg-emerald-950/50 text-emerald-300 border border-emerald-800/50";
  return "bg-zinc-800/50 text-zinc-300 border border-zinc-700/50";
}
