"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  AlertCircle,
  Info,
  ShieldAlert,
  Search,
  Clock,
  User,
  Server,
  Key,
  Hash,
} from "lucide-react";

export type AuditdEvent = {
  id: string;
  eventType: string;
  severity: string;
  typeCode: number | null;
  process: string | null;
  pid: number | null;
  uid: string | null;
  euid: string | null;
  message: string;
  rawData: any;
  eventTime: string;
  count: number;
  agent: {
    name: string;
    hostname: string | null;
    ip: string | null;
  } | null;
};

export type AuditdEventsData = {
  events: AuditdEvent[];
  total: number;
  range: string;
  q?: string;
};

const SEVERITY_META: Record<
  string,
  { label: string; color: string; bg: string; icon: any }
> = {
  INFO: {
    label: "Info",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/30",
    icon: Info,
  },
  WARN: {
    label: "Warning",
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/30",
    icon: AlertTriangle,
  },
  ERROR: {
    label: "Error",
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/30",
    icon: AlertCircle,
  },
  CRITICAL: {
    label: "Critical",
    color: "text-rose-500",
    bg: "bg-rose-500/10 border-rose-500/30",
    icon: ShieldAlert,
  },
};

const RANGES = [
  { value: "1h", label: "1 hour" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

const TYPE_FILTERS = [
  { value: "", label: "All types" },
  { value: "USER_LOGIN", label: "USER_LOGIN" },
  { value: "USER_AUTH", label: "USER_AUTH" },
  { value: "USER_START", label: "USER_START" },
  { value: "SERVICE_START", label: "SERVICE_START" },
  { value: "SERVICE_STOP", label: "SERVICE_STOP" },
  { value: "SYSCALL", label: "SYSCALL" },
  { value: "CONFIG_CHANGE", label: "CONFIG_CHANGE" },
];

const SEVERITY_FILTERS = [
  { value: "", label: "All severity" },
  { value: "INFO", label: "Info" },
  { value: "WARN", label: "Warning" },
  { value: "ERROR", label: "Error" },
];

export function AuditdEventsContent({
  initialData,
}: {
  initialData: AuditdEventsData;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState(initialData.q || "");
  const [range, setRange] = useState(initialData.range);
  const [typeFilter, setTypeFilter] = useState(
    searchParams.get("type") || ""
  );
  const [severityFilter, setSeverityFilter] = useState(
    searchParams.get("severity") || ""
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    // Sync state from URL when it changes (e.g., after navigation)
    setSearch(initialData.q || "");
    setRange(initialData.range);
  }, [initialData]);

  const updateUrl = (params: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(params)) {
      if (v && v.length > 0) next.set(k, v);
      else next.delete(k);
    }
    router.push(`/dashboard/events/auditd?${next.toString()}`);
  };

  const handleSearch = () => {
    updateUrl({ q: search, range, type: typeFilter, severity: severityFilter });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  // Group events by auditd_type for summary
  const typeSummary = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of initialData.events) {
      const t = e.rawData?.auditd_type || e.eventType;
      m.set(t, (m.get(t) || 0) + e.count);
    }
    return Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [initialData.events]);

  return (
    <div className="space-y-4">
      {/* Summary chips */}
      <div className="flex flex-wrap gap-2">
        {typeSummary.map(([t, c]) => (
          <span
            key={t}
            className="px-2.5 py-1 text-xs rounded-full bg-slate-800/50 border border-slate-700 text-slate-300"
          >
            <span className="text-slate-100 font-semibold">{c}</span>{" "}
            <span className="text-slate-400">{t}</span>
          </span>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 bg-slate-900/40 border border-slate-800 rounded-lg p-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search message, comm, key, exe..."
            className="w-full pl-9 pr-3 py-2 bg-slate-950/60 border border-slate-700 rounded-md text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-slate-500"
          />
        </div>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-md text-sm text-slate-200"
        >
          {TYPE_FILTERS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>

        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-md text-sm text-slate-200"
        >
          {SEVERITY_FILTERS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        <select
          value={range}
          onChange={(e) => setRange(e.target.value)}
          className="px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-md text-sm text-slate-200"
        >
          {RANGES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>

        <button
          onClick={handleSearch}
          className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-md text-sm font-medium"
        >
          Apply
        </button>
      </div>

      {/* Total + count info */}
      <div className="flex items-center justify-between text-xs text-slate-500 px-1">
        <span>
          Showing {initialData.events.length} of {initialData.total} auditd
          events
        </span>
        <span>
          {initialData.events.reduce((s, e) => s + e.count, 0)} total
          occurrences (deduped)
        </span>
      </div>

      {/* Event list */}
      <div className="space-y-1">
        {initialData.events.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-sm border border-slate-800 rounded-lg">
            No auditd events in the selected range.
          </div>
        ) : (
          initialData.events.map((e) => {
            const sevMeta =
              SEVERITY_META[e.severity] || SEVERITY_META.INFO;
            const SevIcon = sevMeta.icon;
            const isExpanded = expandedId === e.id;
            const auditdType = e.rawData?.auditd_type || e.eventType;
            return (
              <div
                key={e.id}
                className={`border ${sevMeta.bg} rounded-lg px-3 py-2 cursor-pointer hover:border-slate-600 transition-colors`}
                onClick={() => setExpandedId(isExpanded ? null : e.id)}
              >
                <div className="flex items-start gap-3">
                  <SevIcon
                    className={`h-4 w-4 mt-0.5 ${sevMeta.color} flex-shrink-0`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${sevMeta.bg} ${sevMeta.color}`}
                      >
                        {auditdType}
                      </span>
                      <span className="text-slate-200 truncate font-mono text-[13px]">
                        {e.message}
                      </span>
                      {e.count > 1 && (
                        <span className="px-1.5 py-0.5 text-[10px] rounded bg-slate-700 text-slate-300 font-mono">
                          ×{e.count}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(e.eventTime).toLocaleString()}
                      </span>
                      {e.process && (
                        <span className="flex items-center gap-1">
                          <Hash className="h-3 w-3" />
                          pid={e.pid || "?"}
                        </span>
                      )}
                      {e.uid && (
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          uid={e.uid}
                          {e.euid && e.euid !== e.uid && ` (euid=${e.euid})`}
                        </span>
                      )}
                      {e.agent && (
                        <span className="flex items-center gap-1">
                          <Server className="h-3 w-3" />
                          {e.agent.hostname || e.agent.name}
                        </span>
                      )}
                      {e.rawData?.addr && e.rawData.addr !== "?" && (
                        <span className="flex items-center gap-1 font-mono">
                          addr={e.rawData.addr}
                        </span>
                      )}
                      {e.rawData?.key && (
                        <span className="flex items-center gap-1 font-mono">
                          <Key className="h-3 w-3" />
                          {e.rawData.key}
                        </span>
                      )}
                    </div>

                    {/* Expanded: full raw line */}
                    {isExpanded && e.rawData?.raw_excerpt && (
                      <div className="mt-2 p-2 bg-slate-950/60 rounded text-[11px] font-mono text-slate-400 break-all">
                        {e.rawData.raw_excerpt}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
