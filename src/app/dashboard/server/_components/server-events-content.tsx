"use client";

/**
 * ServerEventsContent — Client Component for /dashboard/server
 *
 * Replaces the old server-side data fetching with client-side fetch from
 * /api/events/server. Benefits:
 *   - Debounced live search (no Enter required)
 *   - Search matches message / source / rawData.user / rawData.ip / dates
 *     parsed from query (e.g. "192.168.1.1", "2026-06-19", "today")
 *   - Loading indicator on table only (no full page reload)
 *   - URL remains source of truth → shareable / back-button friendly
 */

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Copy,
  FolderOpen,
  Globe,
  HardDrive,
  Hash,
  Info,
  Loader2,
  RefreshCw,
  Search,
  Server,
  Shield,
  ShieldAlert,
  ShieldOff,
  Terminal,
  User,
  X,
  XCircle,
} from "lucide-react";
import { FilterDropdown, type DropdownOption } from "@/components/filter-dropdown";

// ────────────────────────────────────────────────────────────────────────────
// Pure helpers (mirrored from page.tsx — single source of truth would be a
// shared module; for now duplication keeps the client bundle isolated).
// ────────────────────────────────────────────────────────────────────────────

const SEVERITY_META: Record<string, { label: string; color: string; icon: any }> = {
  INFO: { label: "Info", color: "#10b981", icon: Info },
  WARN: { label: "Warning", color: "#f59e0b", icon: AlertTriangle },
  ERROR: { label: "Error", color: "#ef4444", icon: AlertCircle },
  CRITICAL: { label: "Critical", color: "#dc2626", icon: ShieldAlert },
};

type EventStatus = "SUCCESS" | "FAILED" | "DENIED";

const STATUS_META: Record<EventStatus, { label: string; color: string; icon: any }> = {
  SUCCESS: { label: "Success", color: "#10b981", icon: CheckCircle2 },
  FAILED: { label: "Failed", color: "#ef4444", icon: XCircle },
  DENIED: { label: "Denied", color: "#f59e0b", icon: ShieldOff },
};

function getEventStatus(severity: string, message: string): EventStatus {
  const lower = message.toLowerCase();
  if (/\b(den(y|ied)|blocked|refused|not\s+allowed|rejected)\b/i.test(lower)) return "DENIED";
  if (/\b(fail(ed|ure)?|invalid|unsuccessful|wrong|incorrect)\b/i.test(lower)) return "FAILED";
  if (/\b(ok|accept(ed)?|success(ful)?|logged\s+in|signed\s+in|authenticated)\b/i.test(lower)) return "SUCCESS";
  if (severity === "INFO") return "SUCCESS";
  if (severity === "WARN" || severity === "ERROR" || severity === "CRITICAL") return "FAILED";
  return "FAILED";
}

function getEventIp(rawData: unknown, message: string): string | null {
  if (rawData && typeof rawData === "object" && !Array.isArray(rawData)) {
    const ip = (rawData as Record<string, unknown>).ip;
    if (typeof ip === "string" && ip.length > 0 && ip !== "0.0.0.0") return ip;
  }
  const m =
    message.match(/\b((?:\d{1,3}\.){3}\d{1,3})\b/) ??
    message.match(/from\s+([0-9a-fA-F:]+)\s+/);
  if (m) {
    const candidate = m[1];
    if (/^\d+\.\d+\.\d+\.\d+$/.test(candidate)) {
      const parts = candidate.split(".").map(Number);
      if (parts.every((p) => p >= 0 && p <= 255)) return candidate;
    } else if (candidate.includes(":")) return candidate;
  }
  return null;
}

function getEventUser(rawData: unknown, message: string): string | null {
  if (rawData && typeof rawData === "object" && !Array.isArray(rawData)) {
    const rd = rawData as Record<string, unknown>;
    const u = rd.user ?? rd.username ?? rd.account ?? rd.subject ?? rd.targetUser;
    if (typeof u === "string" && u.length > 0) return u;
  }
  const kvMatch = message.match(/\buser=([a-zA-Z0-9._\-\[\]]+)/);
  if (kvMatch) return kvMatch[1];
  const forMatch = message.match(
    /\bfor\s+(?:invalid\s+user\s+)?([a-zA-Z0-9._\-\[\]]+)\s+from\b/i,
  );
  if (forMatch) return forMatch[1];
  const userMatch = message.match(
    /\buser\s+([a-zA-Z0-9._\-\[\]]+)\s+(?:not\s+in|is\s+not|from)/i,
  );
  if (userMatch) return userMatch[1];
  return null;
}

const SERVICE_META: Record<string, { label: string; color: string; icon: any }> = {
  SSH: { label: "SSH", color: "#06b6d4", icon: Terminal },
  SFTP: { label: "SFTP", color: "#3b82f6", icon: FolderOpen },
  SCP: { label: "SCP", color: "#a855f7", icon: Copy },
  SUDO: { label: "sudo", color: "#a855f7", icon: Shield },
  CRON: { label: "cron", color: "#84cc16", icon: Clock },
  SYSLOG: { label: "syslog", color: "#64748b", icon: Activity },
  NGINX: { label: "nginx", color: "#22c55e", icon: Globe },
  APACHE: { label: "apache", color: "#f97316", icon: Globe },
  KERNEL: { label: "kernel", color: "#ef4444", icon: HardDrive },
  DISK: { label: "disk", color: "#eab308", icon: HardDrive },
  SERVICE: { label: "service", color: "#3b82f6", icon: Server },
  EVENTLOG: { label: "EVTLOG", color: "#64748b", icon: Activity },
};

// Extract port info from raw_data. Returns { client, server, isStandard } or null.
// Client port is the ephemeral source port (random per connection).
// Server port is the SSH/daemon listen port (stable, usually 22).
// isStandard=false highlights non-standard server ports (security audit).
function getEventPort(rawData: unknown): {
  client: number | null;
  server: number | null;
  isStandard: boolean;
} | null {
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) return null;
  const rd = rawData as Record<string, unknown>;
  const client =
    typeof rd.port === "number"
      ? rd.port
      : typeof rd.clientPort === "number"
        ? rd.clientPort
        : null;
  const server =
    typeof rd.serverPort === "number"
      ? rd.serverPort
      : typeof rd.dstPort === "number"
        ? rd.dstPort
        : null;
  if (client === null && server === null) return null;
  const isStandard = server === 22 || server === null;
  return { client, server, isStandard };
}

function getEventType(rawData: unknown, message: string, source: string): string | null {
  if (rawData && typeof rawData === "object" && !Array.isArray(rawData)) {
    const rd = rawData as Record<string, unknown>;
    const t = rd.service ?? rd.eventType ?? rd.category;
    if (typeof t === "string" && t.length > 0) return t.toUpperCase();
  }
  const lower = message.toLowerCase();
  // SFTP/SCP/TCP-forwarding are SSH subsystems — must be checked BEFORE the
  // generic /ssh|sshd/ rule below, otherwise they all collapse into "SSH".
  if (/subsystem\s+(sftp|internal-sftp)/.test(lower)) return "SFTP";
  if (/subsystem\s+request/.test(lower) && /sftp/.test(lower)) return "SFTP";
  if (/\bsftp\b/.test(lower) && /(subsystem|session|request)/.test(lower)) return "SFTP";
  if (/scp|sftp-server/.test(lower) && /subsystem|session/.test(lower)) return "SCP";
  if (/sudo|pam_unix\(sudo/.test(lower)) return "SUDO";
  if (/ssh|sshd|openssh/.test(lower)) return "SSH";
  if (/nginx/.test(lower) || source.includes("nginx")) return "NGINX";
  if (/apache|httpd/.test(lower) || source.includes("apache")) return "APACHE";
  if (/cron|crontab/.test(lower)) return "CRON";
  if (/kernel|oom-killer|segfault/.test(lower) || source.includes("kern")) return "KERNEL";
  if (/disk space|filesystem|inode/.test(lower)) return "DISK";
  if (/systemd|service\s+(started|stopped|failed)/.test(lower)) return "SERVICE";
  if (source.includes("syslog") || source.includes("messages")) return "SYSLOG";
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

type ServerEvent = {
  id: string;
  severity: string;
  source: string;
  message: string;
  rawData: any;
  eventTime: string;
  count: number;
  status: EventStatus;
  agent: { name: string; hostname: string | null; ip: string | null };
};

export type ServerEventsData = {
  events: ServerEvent[];
  total: number;
  displayed: number;
  filteredTotal: number;
  statusCounts: Record<EventStatus, number>;
  statusFilter: string;
  range: string;
  q: string;
  hideRevoked: boolean;
};

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

const RANGE_OPTIONS: DropdownOption[] = [
  { value: "1h", label: "Last 1 hour", shortLabel: "1h" },
  { value: "24h", label: "Last 24 hours", shortLabel: "24h" },
  { value: "7d", label: "Last 7 days", shortLabel: "7d" },
];

export function ServerEventsContent({
  initialData,
}: {
  initialData: ServerEventsData;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();

  // ── search input (immediate UI feedback) ─────────────────────────────────
  const [qInput, setQInput] = useState(sp.get("q") || "");
  const lastSyncedQ = useRef(sp.get("q") || "");

  // Keep input in sync if URL changes externally (back/forward, filter click)
  useEffect(() => {
    const urlQ = sp.get("q") || "";
    if (urlQ !== lastSyncedQ.current) {
      lastSyncedQ.current = urlQ;
      setQInput(urlQ);
    }
  }, [sp]);

  // ── data state ────────────────────────────────────────────────────────────
  const [data, setData] = useState<ServerEventsData>(initialData);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── debounced URL update on input change ─────────────────────────────────
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

  // Bumps a `nonce` state to force re-run even when URL params are unchanged.
  const [refreshNonce, setRefreshNonce] = useState(0);
  const manualRefresh = useCallback(() => setRefreshNonce((n) => n + 1), []);

  // ── fetch on URL change OR manual refresh ──────────────────────────
  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      setIsFetching(true);
      setError(null);
      try {
        const res = await fetch(`/api/events/server?${sp.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: ServerEventsData = await res.json();
        if (!cancelled) setData(json);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Failed to load events");
      } finally {
        if (!cancelled) setIsFetching(false);
      }
    };
    fetchData();
    return () => {
      cancelled = true;
    };
  }, [sp, refreshNonce]);

  // ── status dropdown options (derived from data) ───────────────────────────
  const statusOptions: DropdownOption[] = useMemo(
    () => [
      {
        value: "all",
        label: "All statuses",
        shortLabel: "All",
        count:
          data.statusCounts.SUCCESS +
          data.statusCounts.FAILED +
          data.statusCounts.DENIED,
      },
      {
        value: "SUCCESS",
        label: "Success",
        shortLabel: "Success",
        count: data.statusCounts.SUCCESS,
        color: STATUS_META.SUCCESS.color,
        dot: true,
      },
      {
        value: "FAILED",
        label: "Failed",
        shortLabel: "Failed",
        count: data.statusCounts.FAILED,
        color: STATUS_META.FAILED.color,
        dot: true,
      },
      {
        value: "DENIED",
        label: "Denied",
        shortLabel: "Denied",
        count: data.statusCounts.DENIED,
        color: STATUS_META.DENIED.color,
        dot: true,
      },
    ],
    [data.statusCounts],
  );

  const currentParams = useMemo(
    () => ({
      range: data.range !== "24h" ? data.range : undefined,
      status: data.statusFilter !== "all" ? data.statusFilter : undefined,
      q: data.q || undefined,
      hideRevoked: data.hideRevoked === false ? "0" : undefined,
    }),
    [data.range, data.statusFilter, data.q, data.hideRevoked],
  );

  const hasActiveFilter = !!data.q || data.statusFilter !== "all" || data.range !== "24h";

  return (
    <>
      {/* ── Stats row ─────────────────────────────────────────────────── */}
      <div
        className={`grid grid-cols-2 sm:grid-cols-4 gap-3 transition-opacity ${
          isFetching ? "opacity-50" : ""
        }`}
      >
        <StatCard label="Total" value={data.total} />
        <StatCard
          label="Success"
          value={data.statusCounts.SUCCESS}
          dotColor="var(--success)"
          valueColor="var(--success)"
        />
        <StatCard
          label="Failed"
          value={data.statusCounts.FAILED}
          dotColor="var(--danger)"
          valueColor="var(--danger)"
        />
        <StatCard
          label="Denied"
          value={data.statusCounts.DENIED}
          dotColor="var(--warning)"
          valueColor="var(--warning)"
        />
      </div>

      {/* ── Filters + Search ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)] pointer-events-none" />
          <input
            type="text"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Search: ucok · agent:dev_cona user:ucok · service:SFTP · 172.16.19.235 …"
            className="w-full h-9 pl-9 pr-9 text-sm rounded-lg border border-[var(--border)] bg-[var(--surface)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/30 font-mono placeholder:text-[var(--muted-foreground)]/60"
          />
          {(qInput || isFetching) && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {isFetching && (
                <Loader2 className="h-3.5 w-3.5 text-[var(--accent)] animate-spin" />
              )}
              {qInput && !isFetching && (
                <button
                  type="button"
                  onClick={() => setQInput("")}
                  className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  title="Clear search"
                >
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
          label="Status"
          value={data.statusFilter}
          options={statusOptions}
          paramName="status"
          currentParams={currentParams}
        />
        {/* ── Hide revoked toggle ───────────────────────────────────── */}
        <button
          type="button"
          onClick={() => {
            const params = new URLSearchParams(sp.toString());
            if (data.hideRevoked) {
              params.set("hideRevoked", "0");
            } else {
              params.delete("hideRevoked");
            }
            const qs = params.toString();
            startTransition(() => {
              router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
            });
          }}
          className={`h-9 px-2.5 rounded-lg text-xs font-medium flex items-center gap-1.5 border transition-colors ${
            data.hideRevoked
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/15"
              : "bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/15"
          }`}
          title={
            data.hideRevoked
              ? "Events from revoked agents are hidden. Click to show (audit/forensic)."
              : "Showing events from revoked agents. Click to hide (default)."
          }
        >
          {data.hideRevoked ? (
            <>
              <ShieldOff className="h-3.5 w-3.5" />
              Revoked hidden
            </>
          ) : (
            <>
              <Shield className="h-3.5 w-3.5" />
              Revoked shown
            </>
          )}
        </button>
        {hasActiveFilter && (
          <Link
            href="/dashboard/server"
            scroll={false}
            className="h-9 px-2.5 rounded-lg text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-white/[0.04] flex items-center gap-1.5"
          >
            <X className="h-3 w-3" />
            Clear
          </Link>
        )}
        {/* ── Manual refresh button (icon-only, spins on click) ───────── */}
        <button
          type="button"
          onClick={manualRefresh}
          disabled={isFetching}
          className="h-9 px-2.5 rounded-lg text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-white/[0.04] flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-wait transition-colors"
          title={isFetching ? "Refreshing\u2026" : "Refresh events"}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* ── Search hint ─────────────────────────────────────────────── */}
      {data.q && (
        <div className="text-[10px] font-mono text-[var(--muted-foreground)] flex items-center gap-1.5 -mt-1">
          <Search className="h-3 w-3 opacity-50" />
          Searching for:{" "}
          <span className="text-[var(--accent)]">&quot;{data.q}&quot;</span>
          <span className="opacity-60">
            · matches message, source log, user, source IP, and dates (ISO / id-ID)
          </span>
        </div>
      )}

      {/* ── Table ───────────────────────────────────────────────────── */}
      <div className="relative rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        {isFetching && (
          <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5 bg-[var(--surface)]/90 backdrop-blur px-2 py-1 rounded-md border border-[var(--border)] text-[10px] font-mono text-[var(--muted-foreground)]">
            <Loader2 className="h-3 w-3 animate-spin text-[var(--accent)]" />
            Loading…
          </div>
        )}

        {error ? (
          <div className="p-8 text-center">
            <AlertCircle className="h-8 w-8 text-[var(--danger)] mx-auto" />
            <p className="mt-2 text-sm font-semibold">Failed to load events</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)] font-mono">
              {error}
            </p>
          </div>
        ) : data.events.length === 0 ? (
          <div className="p-12 text-center border-2 border-dashed border-[var(--border-strong)] rounded-xl">
            <Server
              className="h-10 w-10 text-[var(--muted-foreground)] mx-auto"
              strokeWidth={1.5}
            />
            <h3 className="mt-4 text-sm font-semibold">
              {data.q
                ? `No events match "${data.q}"`
                : "No server events yet"}
            </h3>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              {data.q
                ? "Coba kata kunci lain atau clear filters"
                : "Belum ada server events dari agent. Heartbeats dari agent bakal kirim system logs (syslog, sudo, nginx) kalau konfigurasinya ada."}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[1100px]">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-white/[0.02] divide-x divide-[var(--border)]">
                    <Th>Status</Th>
                    <Th>Time</Th>
                    <Th>Source log</Th>
                    <Th>User</Th>
                    <Th className="min-w-[180px]">Agent</Th>
                    <Th>Source IP</Th>
                    <Th>Service</Th>
                    <Th>Source Port</Th>
                  </tr>
                </thead>
                <tbody className={isFetching ? "opacity-50 transition-opacity" : ""}>
                  {data.events.map((e) => {
                    const statusMeta = STATUS_META[e.status] ?? STATUS_META.FAILED;
                    const StatusIcon = statusMeta.icon;
                    const ip = getEventIp(e.rawData, e.message);
                    const user = getEventUser(e.rawData, e.message);
                    const service = getEventType(e.rawData, e.message, e.source);
                    const svcMeta = service ? SERVICE_META[service] : null;
                    const SvcIcon = svcMeta?.icon;
                    const port = getEventPort(e.rawData);
                    return (
                      <tr
                        key={e.id}
                        className="border-b border-[var(--border)] last:border-0 hover:bg-white/[0.02] transition-colors divide-x divide-[var(--border)]"
                      >
                        <Td>
                          <span
                            className="inline-flex items-center gap-1.5 text-xs font-medium"
                            style={{ color: statusMeta.color }}
                          >
                            <StatusIcon className="h-3.5 w-3.5" />
                            {statusMeta.label}
                          </span>
                        </Td>
                        <Td>
                          <span className="inline-flex items-center gap-1.5 text-xs font-mono text-[var(--muted-foreground)] whitespace-nowrap justify-center">
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
                          <span className="text-xs font-mono text-[var(--muted-foreground)]">
                            {e.source}
                          </span>
                        </Td>
                        <Td className="text-left">
                          {user ? (
                            <span
                              className="inline-flex items-center gap-1.5"
                              title={`Account: ${user}`}
                            >
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/[0.04] border border-[var(--border)] text-xs font-mono font-medium">
                                <User className="h-3 w-3 opacity-70" />
                                {user}
                              </span>
                              {e.count > 1 && (
                                <span
                                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                                  title={`User ini attempt ${e.count}× dalam 5 menit terakhir`}
                                >
                                  ×{e.count}
                                </span>
                              )}
                            </span>
                          ) : (
                            <Dash />
                          )}
                        </Td>
                        <Td>
                          <div className="font-medium text-zinc-100 whitespace-nowrap">
                            {e.agent.name}
                          </div>
                        </Td>
                        <Td className="text-left">
                          {ip ? (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/[0.04] border border-[var(--border)] text-xs font-mono text-[var(--accent)]"
                              title={`Source IP: ${ip}`}
                            >
                              <Globe className="h-3 w-3 opacity-70" />
                              {ip}
                            </span>
                          ) : (
                            <Dash />
                          )}
                        </Td>
                        <Td>
                          {svcMeta && SvcIcon ? (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-xs font-mono font-medium"
                              style={{
                                backgroundColor: `${svcMeta.color}1a`,
                                borderColor: `${svcMeta.color}40`,
                                color: svcMeta.color,
                              }}
                              title={`Login via ${svcMeta.label}`}
                            >
                              <SvcIcon className="h-3 w-3" />
                              {svcMeta.label}
                            </span>
                          ) : (
                            <Dash />
                          )}
                        </Td>
                        <Td>
                          {port && (port.client !== null || port.server !== null) ? (
                            <span
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-mono font-medium whitespace-nowrap ${
                                port.isStandard
                                  ? "bg-white/[0.04] border-[var(--border)] text-zinc-300"
                                  : "bg-amber-500/15 border-amber-500/40 text-amber-300"
                              }`}
                              title={
                                port.server !== null && port.client !== null
                                  ? `Client source: ${port.client} → Server dest: ${port.server}${port.isStandard ? "" : " (non-standard SSH port)"}`
                                  : port.server !== null
                                    ? `Server port: ${port.server}${port.isStandard ? "" : " (non-standard)"}`
                                    : `Client source port: ${port.client}`
                              }
                            >
                              {port.client !== null && (
                                <>
                                  <Hash className="h-3 w-3 opacity-60" />
                                  {port.client}
                                </>
                              )}
                              {port.client !== null && port.server !== null && (
                                <ArrowRight className="h-3 w-3 opacity-50" />
                              )}
                              {port.server !== null && (
                                <span className={port.isStandard ? "opacity-80" : "font-semibold"}>
                                  {port.server}
                                </span>
                              )}
                              {!port.isStandard && (
                                <AlertTriangle className="h-3 w-3 ml-0.5" />
                              )}
                            </span>
                          ) : (
                            <Dash />
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="text-[10px] text-[var(--muted-foreground)] font-mono px-4 py-2 border-t border-[var(--border)] bg-white/[0.01]">
              Showing {data.displayed} of {data.total} events
              {data.filteredTotal !== data.total && (
                <span className="ml-1 opacity-70">
                  ({data.filteredTotal} match current filters)
                </span>
              )}
              {data.q && (
                <span className="ml-2 text-[var(--accent)]">
                  · search: &quot;{data.q}&quot;
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Local sub-components (kept inline to avoid file bloat)
// ────────────────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  dotColor,
  valueColor,
}: {
  label: string;
  value: number;
  dotColor?: string;
  valueColor?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] font-semibold flex items-center gap-1.5">
        {dotColor && (
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: dotColor }}
          />
        )}
        {label}
      </div>
      <div
        className="mt-1 text-2xl font-semibold font-mono"
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </div>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`text-center px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] ${className}`}>
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 text-center ${className}`}>{children}</td>;
}

function Dash() {
  return <span className="text-[var(--muted-foreground)]/40">—</span>;
}
