"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Clock,
  Info,
  Loader2,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  X,
} from "lucide-react";
import { FilterDropdown, type DropdownOption } from "@/components/filter-dropdown";

const SEVERITY_META: Record<string, { label: string; color: string; icon: any }> = {
  INFO: { label: "Info", color: "#10b981", icon: Info },
  WARN: { label: "Warning", color: "#f59e0b", icon: AlertTriangle },
  ERROR: { label: "Error", color: "#ef4444", icon: AlertCircle },
  CRITICAL: { label: "Critical", color: "#dc2626", icon: ShieldAlert },
};

const CATEGORY_BADGE_META: Record<string, { color: string; emoji: string; label: string }> = {
  auth: { color: "#ef4444", emoji: "🔐", label: "Auth" },
  user: { color: "#f97316", emoji: "👤", label: "User" },
  service: { color: "#3b82f6", emoji: "⚙️", label: "Service" },
  cron: { color: "#a855f7", emoji: "⏰", label: "Cron" },
  network: { color: "#06b6d4", emoji: "🌐", label: "Network" },
  docker: { color: "#0ea5e9", emoji: "🐳", label: "Docker" },
  disk: { color: "#eab308", emoji: "💾", label: "Disk" },
  kernel: { color: "#dc2626", emoji: "🧠", label: "Kernel" },
  hardware: { color: "#84cc16", emoji: "🔌", label: "Hardware" },
  package: { color: "#ec4899", emoji: "📦", label: "Package" },
  system: { color: "#71717a", emoji: "⚪", label: "System" },
};

const RANGE_OPTIONS: DropdownOption[] = [
  { value: "1h", label: "Last 1 hour", shortLabel: "1h" },
  { value: "24h", label: "Last 24 hours", shortLabel: "24h" },
  { value: "7d", label: "Last 7 days", shortLabel: "7d" },
];

const EVENT_KIND_META: Record<string, { label: string; color: string; short: string }> = {
  "syslog.sshd": { label: "SSHD", short: "sshd", color: "#a78bfa" },
  "syslog.sudo": { label: "SUDO", short: "sudo", color: "#c084fc" },
  "syslog.su": { label: "SU", short: "su", color: "#c084fc" },
  "syslog.pam": { label: "PAM", short: "pam", color: "#c084fc" },
  "syslog.user_change": { label: "USER CHANGE", short: "useradd", color: "#f59e0b" },
  "syslog.privilege": { label: "PRIVILEGE", short: "polkit", color: "#ef4444" },
  "syslog.session": { label: "SESSION", short: "session", color: "#10b981" },
  "syslog.service.started": { label: "STARTED", short: "start", color: "#10b981" },
  "syslog.service.failed": { label: "FAILED", short: "fail", color: "#ef4444" },
  "syslog.service.stopped": { label: "STOPPED", short: "stop", color: "#f59e0b" },
  "syslog.cron.job": { label: "CRON", short: "cron", color: "#84cc16" },
  "syslog.network.link": { label: "NET LINK", short: "net", color: "#06b6d4" },
  "syslog.firewall.blocked": { label: "FW BLOCK", short: "fw", color: "#ef4444" },
  "syslog.disk.full": { label: "DISK FULL", short: "disk", color: "#ef4444" },
  "syslog.kernel.segfault": { label: "SEGFAULT", short: "segv", color: "#dc2626" },
  "syslog.line": { label: "SYSLOG", short: "syslog", color: "#71717a" },
  "syslog.malformed": { label: "MALFORMED", short: "?", color: "#ef4444" },
};

type SyslogEvent = {
  id: string;
  severity: string;
  source: string;
  process: string | null;
  description: string;
  eventType: string;
  eventTime: string;
  user: string | null;
  sourceIp: string | null;
  agentName: string | null;
  authDetected: boolean | null;
  count: number;
  port: number | null;
  service: string | null;
  category: string;
};

export type SyslogEventsData = {
  events: SyslogEvent[];
  total: number;
  displayed: number;
  filteredTotal: number;
  range: string;
  q: string;
  showNoise: boolean;
  kindCounts?: Record<string, number>;
  authCount?: number;
  categoryCounts?: Record<string, number>;
  severityCounts?: Record<string, number>;
  activeCategory?: string | null;
  activeSeverity?: string | null;
  userOptions?: DropdownOption[];
  agentOptions?: DropdownOption[];
  portOptions?: DropdownOption[];
  userFilter?: string;
  agentFilter?: string;
  portFilter?: string;
};

function Dash() {
  return <span className="text-zinc-600">—</span>;
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wide text-zinc-500 bg-zinc-900/50 whitespace-nowrap">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-2.5 align-middle text-center whitespace-nowrap">{children}</td>;
}

export function SyslogEventsContent({
  initialData,
}: {
  initialData: SyslogEventsData;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();

  const [qInput, setQInput] = useState(sp.get("q") || "");
  const lastSyncedQ = useRef(sp.get("q") || "");

  useEffect(() => {
    const urlQ = sp.get("q") || "";
    if (urlQ !== lastSyncedQ.current) {
      lastSyncedQ.current = urlQ;
      setQInput(urlQ);
    }
  }, [sp]);

  const [data, setData] = useState<SyslogEventsData>(initialData);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const manualRefresh = useCallback(() => setRefreshNonce((n) => n + 1), []);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (qInput === lastSyncedQ.current) return;
      const params = new URLSearchParams(sp.toString());
      if (qInput) params.set("q", qInput);
      else params.delete("q");
      const qs = params.toString();
      lastSyncedQ.current = qInput;
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
    }, 300);
    return () => clearTimeout(handle);
  }, [qInput, sp, router, pathname]);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      setIsFetching(true);
      setError(null);
      try {
        const res = await fetch(`/api/events/syslog?${sp.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: SyslogEventsData = await res.json();
        if (!cancelled) setData(json);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Failed to load events");
      } finally {
        if (!cancelled) setIsFetching(false);
      }
    };
    fetchData();
    return () => { cancelled = true; };
  }, [sp, refreshNonce]);

  const currentParams = useMemo(() => ({
    range: data.range !== "24h" ? data.range : undefined,
    q: data.q || undefined,
  }), [data.range, data.q]);

  const SEVERITY_OPTIONS: DropdownOption[] = [
    { value: "", label: "All severities", shortLabel: "All" },
    { value: "critical", label: "Critical", shortLabel: "Critical" },
    { value: "error", label: "Error", shortLabel: "Error" },
    { value: "warning", label: "Warning", shortLabel: "Warning" },
    { value: "info", label: "Info", shortLabel: "Info" },
  ];

  return (
    <div className="space-y-4">
      {data.kindCounts && Object.keys(data.kindCounts).length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-zinc-500 font-medium">Syslog kinds:</span>
          {Object.entries(data.kindCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([kind, count]) => {
              const meta = EVENT_KIND_META[kind] ?? {
                label: kind.toUpperCase(),
                short: kind,
                color: "#71717a",
              };
              return (
                <span
                  key={kind}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded border font-mono font-semibold"
                  style={{
                    backgroundColor: `${meta.color}1a`,
                    borderColor: `${meta.color}40`,
                    color: meta.color,
                  }}
                >
                  {meta.short} ×{count}
                </span>
              );
            })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500 pointer-events-none" />
          <input
            type="text"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Search: process, message..."
            className="w-full h-9 pl-9 pr-9 text-sm rounded-lg border border-zinc-800 bg-zinc-900/50 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 font-mono placeholder:text-zinc-600"
          />
          {(qInput || isFetching) && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {isFetching && <Loader2 className="h-3.5 w-3.5 text-emerald-500 animate-spin" />}
              {qInput && !isFetching && (
                <button onClick={() => setQInput("")} className="text-zinc-500 hover:text-zinc-300">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
        <FilterDropdown
          label="Time"
          value={data.range}
          options={RANGE_OPTIONS}
          paramName="range"
          currentParams={currentParams}
        />
        <FilterDropdown
          label="Severity"
          value={data.activeSeverity ?? ""}
          options={SEVERITY_OPTIONS}
          paramName="severity"
          currentParams={currentParams}
        />
        {data.agentOptions && data.agentOptions.length > 0 && (
          <FilterDropdown
            label="Agent"
            value={data.agentFilter ?? ""}
            options={[{ value: "", label: "All agents", shortLabel: "All" }, ...data.agentOptions]}
            paramName="agent"
            currentParams={currentParams}
          />
        )}
        <button
          type="button"
          onClick={() => {
            const params = new URLSearchParams(sp.toString());
            if (data.showNoise) params.set("showNoise", "1");
            else params.delete("showNoise");
            startTransition(() => {
              router.replace(`?${params.toString()}`, { scroll: false });
            });
          }}
          className={`h-9 px-2.5 rounded-lg text-xs font-medium flex items-center gap-1.5 border transition-colors ${
            data.showNoise
              ? "bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/15"
              : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/15"
          }`}
        >
          {data.showNoise ? "Noise shown" : "Noise hidden"}
        </button>
        <button
          type="button"
          onClick={manualRefresh}
          disabled={isFetching}
          className="h-9 px-2.5 rounded-lg text-xs font-medium text-zinc-500 hover:text-zinc-300 hover:bg-white/5 flex items-center gap-1.5 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="relative rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
        {isFetching && (
          <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5 bg-zinc-900/90 backdrop-blur px-2 py-1 rounded-md border border-zinc-800 text-[10px] font-mono text-zinc-500">
            <Loader2 className="h-3 w-3 animate-spin text-emerald-500" />
            Loading...
          </div>
        )}

        {error ? (
          <div className="p-8 text-center">
            <AlertCircle className="h-8 w-8 text-red-500 mx-auto" />
            <p className="mt-2 text-sm font-semibold text-zinc-100">Failed to load events</p>
            <p className="mt-1 text-xs text-zinc-500 font-mono">{error}</p>
          </div>
        ) : data.events.length === 0 ? (
          <div className="p-12 text-center border-2 border-dashed border-zinc-800 rounded-xl">
            <Server className="h-10 w-10 text-zinc-600 mx-auto" strokeWidth={1.5} />
            <h3 className="mt-4 text-sm font-semibold text-zinc-100">
              {data.q ? `No events match "${data.q}"` : "No syslog events yet"}
            </h3>
            <p className="mt-1 text-xs text-zinc-500">
              {data.q ? "Try different keywords or clear filters" : "Waiting for syslog events from agents"}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1000px]">
              <thead>
                <tr className="border-b border-zinc-800 divide-x divide-zinc-800">
                  <Th>Severity</Th>
                  <Th>Time</Th>
                  <Th>Category</Th>
                  <Th>Process</Th>
                  <Th>Agent</Th>
                  <Th>Message</Th>
                </tr>
              </thead>
              <tbody className={isFetching ? "opacity-50 transition-opacity" : ""}>
                {data.events.map((e) => {
                  const sevMeta = SEVERITY_META[e.severity] ?? SEVERITY_META.INFO;
                  const SevIcon = sevMeta.icon;
                  const catMeta = CATEGORY_BADGE_META[e.category] ?? CATEGORY_BADGE_META.system;
                  return (
                    <tr
                      key={e.id}
                      className="border-b border-zinc-800 last:border-0 hover:bg-white/5 transition-colors divide-x divide-zinc-800"
                    >
                      <Td>
                        <span
                          className="inline-flex items-center gap-1.5 text-xs font-medium"
                          style={{ color: sevMeta.color }}
                        >
                          <SevIcon className="h-3.5 w-3.5" />
                          {sevMeta.label}
                        </span>
                      </Td>
                      <Td>
                        <span className="inline-flex items-center gap-1.5 text-xs font-mono text-zinc-500 justify-center">
                          <Clock className="h-3 w-3 opacity-50" />
                          {new Date(e.eventTime).toLocaleString("id-ID", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </Td>
                      <Td>
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border"
                          style={{
                            backgroundColor: `${catMeta.color}20`,
                            borderColor: `${catMeta.color}40`,
                            color: catMeta.color,
                          }}
                        >
                          {catMeta.emoji} {catMeta.label}
                        </span>
                      </Td>
                      <Td>
                        {e.process ? (
                          <span className="text-xs font-mono text-zinc-300 bg-zinc-800/50 px-1.5 py-0.5 rounded border border-zinc-700">
                            {e.process}
                          </span>
                        ) : <Dash />}
                      </Td>
                      <Td>
                        {e.agentName ? (
                          <span className="text-xs font-medium text-zinc-100">{e.agentName}</span>
                        ) : <Dash />}
                      </Td>
                      <Td>
                        <p className="text-xs text-zinc-300 line-clamp-2 font-mono text-left" title={e.description}>
                          {e.description}
                        </p>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
