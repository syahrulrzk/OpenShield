"use client";

/**
 * AppsEventsContent — Client Component for /dashboard/events/apps
 *
 * Renders user access events from integrated apps via API ingest.
 * Mirrors the UX shape of NetworkEventsContent.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Clock,
  ExternalLink,
  Filter,
  Hash,
  Info,
  Loader2,
  Box,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldOff,
  User,
  X,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────
// Types (mirror shape returned by /api/events/apps GET)
// ─────────────────────────────────────────────────────────────────────
export type AppEvent = {
  id: string;
  eventTime: string;
  timestamp: string;
  severity: "INFO" | "WARN" | "ERROR" | "CRITICAL";
  eventType: string;
  assetId: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorUsername: string | null;
  actorIp: string | null;
  actorUserAgent: string | null;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  requestId: string | null;
  sessionId: string | null;
  message: string;
  metadata: any;
  rawData: any;
  count: number;
  asset?: {
    id: string;
    hostname: string;
    displayName: string;
    appType: string | null;
  } | null;
};

export type AppsEventsData = {
  events: AppEvent[];
  total: number;
  displayed: number;
  range: string;
  q: string;
  eventTypeCounts: Record<string, number>;
  severityCounts: Record<string, number>;
  appCounts: Record<string, number>;
  actorCounts: Record<string, number>;
  loginFailCount: number;
  loginSuccessCount: number;
  topApps: Array<{ value: string; label: string; count: number }>;
  topActors: Array<{ value: string; label: string; count: number }>;
  eventTypeOptions: Array<{ value: string; label: string; count: number }>;
  severityOptions: Array<{ value: string; label: string; count: number }>;
  filters: {
    appId?: string;
    eventType?: string;
    severity?: string;
    actorEmail?: string;
    actorIp?: string;
  };
};

// ─────────────────────────────────────────────────────────────────────
// Static meta (icon/color/label for event type + severity)
// ─────────────────────────────────────────────────────────────────────
const EVENT_TYPE_META: Record<string, { label: string; color: string; icon: any }> = {
  "user.login": { label: "Login", color: "#10b981", icon: User },
  "user.logout": { label: "Logout", color: "#64748b", icon: User },
  "user.login_failed": { label: "Login Failed", color: "#ef4444", icon: ShieldAlert },
  "user.created": { label: "User Created", color: "#3b82f6", icon: User },
  "user.deleted": { label: "User Deleted", color: "#ef4444", icon: User },
  "user.role_changed": { label: "Role Changed", color: "#f59e0b", icon: Shield },
  "user.permission_granted": { label: "Perm Granted", color: "#10b981", icon: Shield },
  "user.permission_revoked": { label: "Perm Revoked", color: "#f59e0b", icon: ShieldOff },
  "session.created": { label: "Session Created", color: "#06b6d4", icon: Activity },
  "session.expired": { label: "Session Expired", color: "#64748b", icon: Activity },
  "password.changed": { label: "Password Changed", color: "#8b5cf6", icon: User },
  "password.reset_requested": { label: "Password Reset", color: "#f59e0b", icon: User },
  "mfa.enabled": { label: "MFA Enabled", color: "#10b981", icon: Shield },
  "mfa.disabled": { label: "MFA Disabled", color: "#ef4444", icon: Shield },
  custom: { label: "Custom", color: "#71717a", icon: Hash },
};

const SEVERITY_META: Record<string, { label: string; color: string; icon: any }> = {
  INFO: { label: "Info", color: "#10b981", icon: Info },
  WARN: { label: "Warning", color: "#f59e0b", icon: AlertTriangle },
  ERROR: { label: "Error", color: "#ef4444", icon: AlertCircle },
  CRITICAL: { label: "Critical", color: "#dc2626", icon: ShieldAlert },
};

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────
export function AppsEventsContent({
  initialData,
}: {
  initialData: AppsEventsData;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [data, setData] = useState<AppsEventsData>(initialData);
  const [loading, setLoading] = useState(false);
  const [searchInput, setSearchInput] = useState(initialData.q || "");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read current filter from URL
  const filters = useMemo(() => {
    return {
      range: searchParams.get("range") || initialData.range,
      q: searchParams.get("q") || "",
      appId: searchParams.get("appId") || "",
      eventType: searchParams.get("eventType") || "",
      severity: searchParams.get("severity") || "",
      actorEmail: searchParams.get("actorEmail") || "",
      actorIp: searchParams.get("actorIp") || "",
    };
  }, [searchParams, initialData.range]);

  // Build API URL from current filters
  const buildUrl = useCallback(() => {
    const sp = new URLSearchParams();
    sp.set("range", filters.range || "24h");
    if (filters.q) sp.set("q", filters.q);
    if (filters.appId) sp.set("appId", filters.appId);
    if (filters.eventType) sp.set("eventType", filters.eventType);
    if (filters.severity) sp.set("severity", filters.severity);
    if (filters.actorEmail) sp.set("actorEmail", filters.actorEmail);
    if (filters.actorIp) sp.set("actorIp", filters.actorIp);
    return `/api/events/apps?${sp.toString()}`;
  }, [filters]);

  // Fetch when filters change
  const firstMount = useRef(true);
  useEffect(() => {
    if (firstMount.current) {
      firstMount.current = false;
      return;
    }
    setLoading(true);
    fetch(buildUrl())
      .then((r) => r.json())
      .then((d: AppsEventsData) => setData(d))
      .finally(() => setLoading(false));
  }, [buildUrl]);

  // Push URL state when a filter chip is toggled
  const updateFilter = useCallback(
    (key: string, value: string | null) => {
      const sp = new URLSearchParams(searchParams.toString());
      if (!value) sp.delete(key);
      else sp.set(key, value);
      startTransition(() => router.push(`${pathname}?${sp.toString()}`));
    },
    [searchParams, router, pathname]
  );

  // Debounced search
  const onSearchChange = (v: string) => {
    setSearchInput(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateFilter("q", v || null);
    }, 400);
  };

  const clearAll = () => {
    setSearchInput("");
    startTransition(() => router.push(pathname));
  };

  // Active filter state
  const hasActiveFilter =
    !!(
      filters.appId ||
      filters.eventType ||
      filters.severity ||
      filters.actorEmail ||
      filters.actorIp ||
      filters.q
    );

  return (
    <div className="space-y-4">
      {/* ── Toolbar ──────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Search: app, actor, event type, message, ip:10.0.0.5 …"
            value={searchInput}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-[var(--card)] border border-[var(--border)] text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 focus:border-[var(--accent)]/50 transition-colors"
          />
          {searchInput && (
            <button
              onClick={() => onSearchChange("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Range picker */}
        <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--card)] p-1">
          {[
            { id: "1h", label: "1h" },
            { id: "24h", label: "24h" },
            { id: "7d", label: "7d" },
          ].map((r) => (
            <button
              key={r.id}
              onClick={() => updateFilter("range", r.id === "24h" ? null : r.id)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                filters.range === r.id
                  ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Refresh */}
        <button
          onClick={() => {
            setLoading(true);
            fetch(buildUrl())
              .then((r) => r.json())
              .then((d) => setData(d))
              .finally(() => setLoading(false));
          }}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--card)] text-xs text-zinc-300 hover:bg-zinc-800/50 transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </button>
      </div>

      {/* ── Active filter chips ─────────────────────────────────── */}
      {hasActiveFilter && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-zinc-500">Active:</span>
          {filters.appId && (
            <Chip color="#10b981" label={`app:${filters.appId}`} onClear={() => updateFilter("appId", null)} />
          )}
          {filters.eventType && (
            <Chip color={EVENT_TYPE_META[filters.eventType]?.color ?? "#71717a"} label={`type:${filters.eventType}`} onClear={() => updateFilter("eventType", null)} />
          )}
          {filters.severity && (
            <Chip color={SEVERITY_META[filters.severity]?.color ?? "#71717a"} label={`severity:${filters.severity}`} onClear={() => updateFilter("severity", null)} />
          )}
          {filters.actorEmail && (
            <Chip color="#06b6d4" label={`actor:${filters.actorEmail}`} onClear={() => updateFilter("actorEmail", null)} />
          )}
          {filters.actorIp && (
            <Chip color="#06b6d4" label={`ip:${filters.actorIp}`} onClear={() => updateFilter("actorIp", null)} />
          )}
          <button onClick={clearAll} className="text-xs text-zinc-500 hover:text-red-400 ml-1 underline-offset-2 hover:underline">
            clear all
          </button>
        </div>
      )}

      {/* ── Layout: table + side cards ──────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* Table */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]/40 backdrop-blur overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--card)]/60">
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <Activity className="h-3.5 w-3.5" />
              <span>
                <span className="text-zinc-100 font-semibold">{data.displayed}</span> of{" "}
                <span className="text-zinc-100 font-semibold">{data.total}</span> events
              </span>
              {data.total > 100 && <span className="text-zinc-500">(showing first 100)</span>}
            </div>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500" />}
          </div>

          {data.events.length === 0 ? (
            <EmptyState hasFilter={hasActiveFilter} onClear={clearAll} />
          ) : (
            <div className="divide-y divide-[var(--border)]/60">
              {data.events.map((e) => (
                <AppEventRow
                  key={e.id}
                  event={e}
                  expanded={expanded === e.id}
                  onToggle={() => setExpanded(expanded === e.id ? null : e.id)}
                  onFilter={updateFilter}
                />
              ))}
            </div>
          )}
        </div>

        <SideCards data={data} onFilter={updateFilter} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Single event row
// ─────────────────────────────────────────────────────────────────────
function AppEventRow({
  event,
  expanded,
  onToggle,
  onFilter,
}: {
  event: AppEvent;
  expanded: boolean;
  onToggle: () => void;
  onFilter: (key: string, value: string | null) => void;
}) {
  const severity = SEVERITY_META[event.severity] ?? SEVERITY_META.INFO;
  const eventType = EVENT_TYPE_META[event.eventType] ?? EVENT_TYPE_META.custom;
  const SeverityIcon = severity.icon;
  const EventTypeIcon = eventType.icon;

  return (
    <div className="px-4 py-3 hover:bg-[var(--card)]/60 transition-colors">
      {/* Top line: severity · event type · app · actor · time */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left flex items-start gap-3"
      >
        {/* Severity dot */}
        <span
          className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-md flex-shrink-0"
          style={{ backgroundColor: `${severity.color}22`, color: severity.color }}
          title={severity.label}
        >
          <SeverityIcon className="h-3.5 w-3.5" />
        </span>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            {/* Event type badge */}
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium"
              style={{ backgroundColor: `${eventType.color}22`, color: eventType.color }}
            >
              <EventTypeIcon className="h-3 w-3" />
              {eventType.label}
            </span>
            {/* App */}
            {event.asset && (
              <Link
                href={`/dashboard/apps?assetId=${event.asset.id}`}
                className="text-zinc-200 hover:text-[var(--accent)] transition-colors font-medium"
                onClick={(e) => e.stopPropagation()}
                title="Filter by this app"
              >
                {event.asset.displayName || event.asset.hostname}
              </Link>
            )}
            {/* Actor */}
            {event.actorEmail && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onFilter("actorEmail", event.actorEmail);
                }}
                className="text-zinc-300 hover:text-[var(--accent)] transition-colors"
                title="Filter by this actor"
              >
                {event.actorEmail}
              </button>
            )}
            {/* Actor username */}
            {event.actorUsername && !event.actorEmail && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onFilter("actorEmail", event.actorUsername);
                }}
                className="text-zinc-300 hover:text-[var(--accent)] transition-colors"
                title="Filter by this actor"
              >
                {event.actorUsername}
              </button>
            )}
            {/* Count badge */}
            {event.count > 1 && (
              <span className="text-[10px] text-zinc-500 font-mono">
                ×{event.count}
              </span>
            )}
            {/* Spacer */}
            <span className="flex-1" />
            {/* Time */}
            <span className="text-zinc-500 text-[11px] flex-shrink-0 inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {event.timestamp}
            </span>
          </div>

          {/* Message */}
          <div className="mt-1 text-xs text-zinc-300 line-clamp-2 break-words">
            {event.message}
          </div>

          {/* Quick meta row: actor ip / user agent / session id */}
          <div className="mt-1 flex items-center gap-3 text-[10px] text-zinc-500 font-mono">
            {event.actorIp && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onFilter("actorIp", event.actorIp);
                }}
                className="hover:text-[var(--accent)] transition-colors"
                title="Filter by this source IP"
              >
                {event.actorIp}
              </button>
            )}
            {event.sessionId && <span>session: {event.sessionId}</span>}
            {event.requestId && <span>req: {event.requestId}</span>}
            {event.targetType && event.targetName && (
              <span>{event.targetType}: {event.targetName}</span>
            )}
          </div>
        </div>
      </button>

      {/* Expanded details panel */}
      {expanded && (
        <div className="mt-3 ml-9 rounded-lg border border-[var(--border)] bg-zinc-900/40 p-3">
          <div className="grid grid-cols-2 gap-4 text-xs mb-3">
            {event.actorEmail && <div><span className="text-zinc-500">Actor Email:</span> <span className="text-zinc-200">{event.actorEmail}</span></div>}
            {event.actorUsername && <div><span className="text-zinc-500">Actor Username:</span> <span className="text-zinc-200">{event.actorUsername}</span></div>}
            {event.actorUserId && <div><span className="text-zinc-500">Actor ID:</span> <span className="text-zinc-200">{event.actorUserId}</span></div>}
            {event.actorIp && <div><span className="text-zinc-500">Actor IP:</span> <span className="text-zinc-200">{event.actorIp}</span></div>}
            {event.actorUserAgent && <div className="col-span-2"><span className="text-zinc-500">User Agent:</span> <span className="text-zinc-200 break-all">{event.actorUserAgent}</span></div>}
            {event.targetType && <div><span className="text-zinc-500">Target Type:</span> <span className="text-zinc-200">{event.targetType}</span></div>}
            {event.targetId && <div><span className="text-zinc-500">Target ID:</span> <span className="text-zinc-200">{event.targetId}</span></div>}
            {event.targetName && <div><span className="text-zinc-500">Target Name:</span> <span className="text-zinc-200">{event.targetName}</span></div>}
          </div>
          {event.metadata && (
            <div className="mb-3">
              <h4 className="text-xs text-zinc-500 mb-1">Metadata:</h4>
              <pre className="text-[11px] text-zinc-300 font-mono whitespace-pre-wrap break-all bg-zinc-800/30 rounded p-2">
                {JSON.stringify(event.metadata, null, 2)}
              </pre>
            </div>
          )}
          {event.rawData && (
            <div>
              <h4 className="text-xs text-zinc-500 mb-1">Raw Data:</h4>
              <pre className="text-[11px] text-zinc-300 font-mono whitespace-pre-wrap break-all bg-zinc-800/30 rounded p-2">
                {JSON.stringify(event.rawData, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Side cards
// ─────────────────────────────────────────────────────────────────────
function SideCards({
  data,
  onFilter,
}: {
  data: AppsEventsData;
  onFilter: (key: string, value: string | null) => void;
}) {
  return (
    <div className="space-y-3">
      {/* Top apps */}
      <Card title="By App" icon={Box}>
        {data.topApps.length === 0 ? (
          <Empty text="No events yet" />
        ) : (
          <div className="space-y-1.5">
            {data.topApps.map((d) => (
              <button
                key={d.value}
                onClick={() => onFilter("appId", d.value)}
                className="w-full flex items-center justify-between text-xs hover:bg-zinc-800/40 -mx-1 px-1 py-0.5 rounded transition-colors"
              >
                <span className="text-zinc-300 truncate">{d.label}</span>
                <span className="text-zinc-400 font-mono ml-2 flex-shrink-0">{d.count}</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* Top actors */}
      <Card title="Top Actors" icon={User}>
        {data.topActors.length === 0 ? (
          <Empty text="No events yet" />
        ) : (
          <div className="space-y-1.5">
            {data.topActors.map((d) => (
              <button
                key={d.value}
                onClick={() => onFilter("actorEmail", d.value)}
                className="w-full flex items-center justify-between text-xs hover:bg-zinc-800/40 -mx-1 px-1 py-0.5 rounded transition-colors"
              >
                <span className="text-zinc-300 truncate">{d.label}</span>
                <span className="text-zinc-400 font-mono ml-2 flex-shrink-0">{d.count}</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* Security signals: login fails / success */}
      <Card title="Security Signals" icon={ShieldAlert}>
        <div className="space-y-2">
          <SignalRow
            label="Login failures"
            count={data.loginFailCount}
            color="#ef4444"
            onClick={() => onFilter("eventType", "user.login_failed")}
          />
          <SignalRow
            label="Login success"
            count={data.loginSuccessCount}
            color="#10b981"
            onClick={() => onFilter("eventType", "user.login")}
          />
        </div>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Small UI primitives
// ─────────────────────────────────────────────────────────────────────
function Chip({
  color,
  label,
  onClear,
}: {
  color: string;
  label: string;
  onClear: () => void;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium font-mono"
      style={{ backgroundColor: `${color}22`, color }}
    >
      {label}
      <button onClick={onClear} className="opacity-70 hover:opacity-100">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function Card({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: any;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]/40 backdrop-blur p-3">
      <div className="flex items-center gap-1.5 mb-2 text-xs text-zinc-400">
        <Icon className="h-3.5 w-3.5" />
        <span className="font-medium uppercase tracking-wider">{title}</span>
      </div>
      {children}
    </div>
  );
}

function SignalRow({
  label,
  count,
  color,
  onClick,
}: {
  label: string;
  count: number;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={count === 0}
      className="w-full flex items-center justify-between text-xs hover:bg-zinc-800/40 -mx-1 px-1 py-1 rounded transition-colors disabled:cursor-not-allowed"
    >
      <span className="inline-flex items-center gap-1.5 text-zinc-300">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        {label}
      </span>
      <span
        className="font-mono font-semibold"
        style={{ color: count > 0 ? color : "#52525b" }}
      >
        {count}
      </span>
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-[11px] text-zinc-500 text-center py-2">{text}</div>;
}

function EmptyState({ hasFilter, onClear }: { hasFilter: boolean; onClear: () => void }) {
  return (
    <div className="px-4 py-12 text-center">
      <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800/50 mb-3">
        <Box className="h-6 w-6 text-zinc-500" />
      </div>
      <div className="text-sm text-zinc-300">
        {hasFilter ? "No events match the current filters" : "No app events yet"}
      </div>
      <div className="text-[11px] text-zinc-500 mt-1 max-w-sm mx-auto">
        {hasFilter
          ? "Try clearing some filters or expanding the time range."
          : "Integrate apps via API key and send user access events to /api/ingest/apps."}
      </div>
      {hasFilter && (
        <button
          onClick={onClear}
          className="mt-3 text-xs text-[var(--accent)] hover:underline"
        >
          Clear all filters
        </button>
      )}
    </div>
  );
}
