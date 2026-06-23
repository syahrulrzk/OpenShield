"use client";

/**
 * NetworkEventsContent — Client Component for /dashboard/events/network
 *
 * Renders the table + filters + side cards for network device syslog
 * events (Cisco / MikroTik / Fortinet / generic). Mirrors the UX shape
 * of ServerEventsContent but uses fields unique to network events:
 *   - vendor, eventKind, hostname, srcIp
 *   - interface (port/iface name)
 *   - aclRule, bgpNeighborIp (when applicable)
 *   - asset link (inventory device)
 *
 * Fetches from /api/events/network with debounced live search.
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
  Network,
  Radio,
  RefreshCw,
  Router,
  Search,
  Shield,
  ShieldAlert,
  ShieldOff,
  X,
  Zap,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────
// Types (mirror shape returned by /api/events/network GET)
// ─────────────────────────────────────────────────────────────────────
export type NetworkEvent = {
  id: string;
  eventTime: string;
  timestamp: string;
  severity: "INFO" | "WARN" | "ERROR" | "CRITICAL";
  rawSeverity: number | null;
  vendor: "cisco" | "mikrotik" | "fortinet" | "generic";
  hostname: string;
  srcIp: string;
  inventoryMgmtIp: string | null;
  eventKind:
    | "link"
    | "acl"
    | "bgp"
    | "auth"
    | "config-change"
    | "dot1x"
    | "dhcp"
    | "mac-flap"
    | "port-security"
    | "routing"
    | "system"
    | "other";
  interface: string | null;
  sourceMac: string | null;
  vlan: number | null;
  aclRule: string | null;
  bgpNeighborIp: string | null;
  description: string;
  rawData: any;
  count: number;
  assetId: string | null;
  agent_name: string | null;
  device_label: string;
  inventoryLinked: boolean;
  agent?: { name: string; hostname: string | null; ip: string | null } | null;
  asset?: {
    id: string;
    hostname: string;
    displayName: string;
    vendor: string | null;
    model: string | null;
    mgmtIp: string | null;
  } | null;
};

export type NetworkEventsData = {
  events: NetworkEvent[];
  total: number;
  displayed: number;
  range: string;
  q: string;
  hideRevoked: boolean;
  vendorCounts: Record<string, number>;
  kindCounts: Record<string, number>;
  deviceCounts: Record<string, number>;
  interfaceCounts: Record<string, number>;
  severityCounts: Record<string, number>;
  aclDenyCount: number;
  authFailCount: number;
  linkDownCount: number;
  configChangeCount: number;
  topDevices: Array<{ value: string; label: string; count: number }>;
  topInterfaces: Array<{ value: string; label: string; count: number }>;
  vendorOptions: Array<{ value: string; label: string; count: number }>;
  kindOptions: Array<{ value: string; label: string; count: number }>;
  severityOptions: Array<{ value: string; label: string; count: number }>;
  filters: {
    vendor?: string;
    eventKind?: string;
    severity?: string;
    hostname?: string;
    srcIp?: string;
    assetId?: string;
  };
};

// ─────────────────────────────────────────────────────────────────────
// Static meta (icon/color/label for vendor + kind + severity)
// ─────────────────────────────────────────────────────────────────────
const VENDOR_META: Record<string, { label: string; color: string; icon: any }> = {
  cisco: { label: "Cisco", color: "#049fd9", icon: Router },
  mikrotik: { label: "MikroTik", color: "#293239", icon: Radio },
  fortinet: { label: "Fortinet", color: "#da291c", icon: Shield },
  generic: { label: "Generic", color: "#71717a", icon: Network },
};

const KIND_META: Record<string, { label: string; color: string; icon: any }> = {
  link: { label: "Link", color: "#3b82f6", icon: Activity },
  acl: { label: "ACL", color: "#f59e0b", icon: ShieldAlert },
  bgp: { label: "BGP", color: "#a855f7", icon: Zap },
  auth: { label: "Auth", color: "#ef4444", icon: ShieldOff },
  "config-change": { label: "Config", color: "#10b981", icon: Filter },
  dot1x: { label: "802.1X", color: "#06b6d4", icon: Shield },
  dhcp: { label: "DHCP", color: "#84cc16", icon: Network },
  "mac-flap": { label: "MAC Flap", color: "#f97316", icon: Activity },
  "port-security": { label: "Port Sec", color: "#dc2626", icon: ShieldOff },
  routing: { label: "Routing", color: "#8b5cf6", icon: ArrowRight },
  system: { label: "System", color: "#64748b", icon: Info },
  other: { label: "Other", color: "#52525b", icon: Hash },
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
export function NetworkEventsContent({
  initialData,
}: {
  initialData: NetworkEventsData;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [data, setData] = useState<NetworkEventsData>(initialData);
  const [loading, setLoading] = useState(false);
  const [searchInput, setSearchInput] = useState(initialData.q || "");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read current filter from URL (so chip clicks + back-button stay in sync)
  const filters = useMemo(() => {
    return {
      range: searchParams.get("range") || initialData.range,
      q: searchParams.get("q") || "",
      vendor: searchParams.get("vendor") || "",
      eventKind: searchParams.get("eventKind") || "",
      severity: searchParams.get("severity") || "",
      hostname: searchParams.get("hostname") || "",
      srcIp: searchParams.get("srcIp") || "",
      assetId: searchParams.get("assetId") || "",
    };
  }, [searchParams, initialData.range]);

  // Build API URL from current filters
  const buildUrl = useCallback(() => {
    const sp = new URLSearchParams();
    sp.set("range", filters.range || "24h");
    if (filters.q) sp.set("q", filters.q);
    if (filters.vendor) sp.set("vendor", filters.vendor);
    if (filters.eventKind) sp.set("eventKind", filters.eventKind);
    if (filters.severity) sp.set("severity", filters.severity);
    if (filters.hostname) sp.set("hostname", filters.hostname);
    if (filters.srcIp) sp.set("srcIp", filters.srcIp);
    if (filters.assetId) sp.set("assetId", filters.assetId);
    return `/api/events/network?${sp.toString()}`;
  }, [filters]);

  // Fetch when filters change (skip on first mount since initialData covers it)
  const firstMount = useRef(true);
  useEffect(() => {
    if (firstMount.current) {
      firstMount.current = false;
      return;
    }
    setLoading(true);
    fetch(buildUrl())
      .then((r) => r.json())
      .then((d: NetworkEventsData) => setData(d))
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

  // Debounced search: typing in input → updates `q` after 400ms idle
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
      filters.vendor ||
      filters.eventKind ||
      filters.severity ||
      filters.hostname ||
      filters.srcIp ||
      filters.assetId ||
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
            placeholder="Search: hostname, srcIp, interface, vendor:cisco, kind:acl, ip:10.0.0.5 …"
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
          {filters.vendor && (
            <Chip color={VENDOR_META[filters.vendor]?.color ?? "#71717a"} label={`vendor:${filters.vendor}`} onClear={() => updateFilter("vendor", null)} />
          )}
          {filters.eventKind && (
            <Chip color={KIND_META[filters.eventKind]?.color ?? "#71717a"} label={`kind:${filters.eventKind}`} onClear={() => updateFilter("eventKind", null)} />
          )}
          {filters.severity && (
            <Chip color={SEVERITY_META[filters.severity]?.color ?? "#71717a"} label={`severity:${filters.severity}`} onClear={() => updateFilter("severity", null)} />
          )}
          {filters.hostname && (
            <Chip color="#06b6d4" label={`device:${filters.hostname}`} onClear={() => updateFilter("hostname", null)} />
          )}
          {filters.srcIp && (
            <Chip color="#06b6d4" label={`ip:${filters.srcIp}`} onClear={() => updateFilter("srcIp", null)} />
          )}
          {filters.assetId && (
            <Chip color="#10b981" label="inventory-linked" onClear={() => updateFilter("assetId", null)} />
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
                <NetworkEventRow
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
function NetworkEventRow({
  event,
  expanded,
  onToggle,
  onFilter,
}: {
  event: NetworkEvent;
  expanded: boolean;
  onToggle: () => void;
  onFilter: (key: string, value: string | null) => void;
}) {
  const severity = SEVERITY_META[event.severity] ?? SEVERITY_META.INFO;
  const vendor = VENDOR_META[event.vendor] ?? VENDOR_META.generic;
  const kind = KIND_META[event.eventKind] ?? KIND_META.other;
  const SeverityIcon = severity.icon;
  const VendorIcon = vendor.icon;
  const KindIcon = kind.icon;

  // Compact description: strip leading severity mnemonics if present
  const description = event.description || event.rawData?.message || "";

  return (
    <div className="px-4 py-3 hover:bg-[var(--card)]/60 transition-colors">
      {/* Top line: severity · vendor · device · interface · kind · time */}
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
            {/* Vendor badge */}
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium"
              style={{ backgroundColor: `${vendor.color}22`, color: vendor.color }}
            >
              <VendorIcon className="h-3 w-3" />
              {vendor.label}
            </span>
            {/* Kind badge */}
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium"
              style={{ backgroundColor: `${kind.color}22`, color: kind.color }}
            >
              <KindIcon className="h-3 w-3" />
              {kind.label}
            </span>
            {/* Device */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onFilter("hostname", event.hostname);
              }}
              className="text-zinc-200 hover:text-[var(--accent)] transition-colors font-medium"
              title="Filter by this device"
            >
              {event.device_label}
            </button>
            {/* Interface (if any) */}
            {event.interface && (
              <span className="text-zinc-400 font-mono text-[11px] px-1 py-0.5 rounded bg-zinc-800/50">
                {event.interface}
              </span>
            )}
            {/* VLAN */}
            {event.vlan !== null && event.vlan !== undefined && (
              <span className="text-[10px] text-zinc-500 font-mono">vlan {event.vlan}</span>
            )}
            {/* Inventory link */}
            {event.inventoryLinked && event.asset && (
              <Link
                href={`/dashboard/endpoints/network?assetId=${event.asset.id}`}
                className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 text-[10px] font-medium"
                onClick={(e) => e.stopPropagation()}
                title="Linked to inventory asset"
              >
                <ExternalLink className="h-2.5 w-2.5" />
                {event.asset.displayName}
              </Link>
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

          {/* Description */}
          <div className="mt-1 text-xs text-zinc-300 font-mono line-clamp-2 break-words">
            {description}
          </div>

          {/* Quick meta row: srcIp / agent */}
          <div className="mt-1 flex items-center gap-3 text-[10px] text-zinc-500 font-mono">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onFilter("srcIp", event.srcIp);
              }}
              className="hover:text-[var(--accent)] transition-colors"
              title="Filter by this source IP"
            >
              {event.srcIp}
            </button>
            {event.aclRule && <span>ACL: {event.aclRule}</span>}
            {event.bgpNeighborIp && <span>BGP: {event.bgpNeighborIp}</span>}
            {event.sourceMac && <span>MAC: {event.sourceMac}</span>}
            {event.agent_name && <span>agent: {event.agent_name}</span>}
            {event.rawSeverity !== null && event.rawSeverity !== undefined && (
              <span title="Cisco severity 0-7">raw: {event.rawSeverity}</span>
            )}
          </div>
        </div>
      </button>

      {/* Expanded details panel */}
      {expanded && (
        <div className="mt-3 ml-9 rounded-lg border border-[var(--border)] bg-zinc-900/40 p-3">
          <pre className="text-[11px] text-zinc-300 font-mono whitespace-pre-wrap break-all max-h-72 overflow-y-auto">
            {JSON.stringify(event.rawData ?? {}, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Side cards: vendor mix, top devices, ACL denies, link flaps, auth fails
// ─────────────────────────────────────────────────────────────────────
function SideCards({
  data,
  onFilter,
}: {
  data: NetworkEventsData;
  onFilter: (key: string, value: string | null) => void;
}) {
  return (
    <div className="space-y-3">
      {/* Vendor mix */}
      <Card title="By Vendor" icon={Router}>
        <div className="space-y-1.5">
          {Object.entries(data.vendorCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([v, c]) => {
              const meta = VENDOR_META[v] ?? VENDOR_META.generic;
              const Icon = meta.icon;
              return (
                <button
                  key={v}
                  onClick={() => onFilter("vendor", v)}
                  className="w-full flex items-center justify-between text-xs hover:bg-zinc-800/40 -mx-1 px-1 py-0.5 rounded transition-colors"
                >
                  <span className="inline-flex items-center gap-1.5" style={{ color: meta.color }}>
                    <Icon className="h-3 w-3" />
                    {meta.label}
                  </span>
                  <span className="text-zinc-400 font-mono">{c}</span>
                </button>
              );
            })}
        </div>
      </Card>

      {/* Top devices by event count */}
      <Card title="Top Devices" icon={Network}>
        {data.topDevices.length === 0 ? (
          <Empty text="No events yet" />
        ) : (
          <div className="space-y-1.5">
            {data.topDevices.map((d) => (
              <button
                key={d.value}
                onClick={() => onFilter("hostname", d.value)}
                className="w-full flex items-center justify-between text-xs hover:bg-zinc-800/40 -mx-1 px-1 py-0.5 rounded transition-colors"
              >
                <span className="text-zinc-300 truncate">{d.label}</span>
                <span className="text-zinc-400 font-mono ml-2 flex-shrink-0">{d.count}</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* Security signals: ACL deny / Auth fail / Link down */}
      <Card title="Security Signals" icon={ShieldAlert}>
        <div className="space-y-2">
          <SignalRow
            label="ACL denies"
            count={data.aclDenyCount}
            color="#f59e0b"
            onClick={() => onFilter("eventKind", "acl")}
          />
          <SignalRow
            label="Auth failures"
            count={data.authFailCount}
            color="#ef4444"
            onClick={() => onFilter("eventKind", "auth")}
          />
          <SignalRow
            label="Link down"
            count={data.linkDownCount}
            color="#3b82f6"
            onClick={() => onFilter("eventKind", "link")}
          />
          <SignalRow
            label="Config changes"
            count={data.configChangeCount}
            color="#10b981"
            onClick={() => onFilter("eventKind", "config-change")}
          />
        </div>
      </Card>

      {/* Top interfaces (when flaps/ACL hits cluster on a port) */}
      {data.topInterfaces.length > 0 && (
        <Card title="Top Interfaces" icon={Activity}>
          <div className="space-y-1.5">
            {data.topInterfaces.map((i) => (
              <div key={i.value} className="flex items-center justify-between text-xs">
                <span className="text-zinc-300 font-mono truncate">{i.label}</span>
                <span className="text-zinc-400 font-mono ml-2 flex-shrink-0">{i.count}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
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
        <Network className="h-6 w-6 text-zinc-500" />
      </div>
      <div className="text-sm text-zinc-300">
        {hasFilter ? "No events match the current filters" : "No network events yet"}
      </div>
      <div className="text-[11px] text-zinc-500 mt-1 max-w-sm mx-auto">
        {hasFilter
          ? "Try clearing some filters or expanding the time range."
          : "Network syslog is received on UDP/514. Configure your device to send logs to this host, then enable the listener in /etc/openshield/agent.json."}
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
