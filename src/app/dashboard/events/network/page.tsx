import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { getSession } from "@/lib/security/rbac";
import {
  AlertCircle,
  AlertTriangle,
  Info,
  Network,
  Router,
  Radio,
  Shield,
  ShieldAlert,
  Activity,
  Hash,
  Filter,
  Zap,
  ArrowRight,
  ShieldOff,
  Box,
} from "lucide-react";
import { subHours, subDays } from "date-fns";
import Link from "next/link";
import { parseDateFromQuery } from "@/lib/search/query-parsers";
import {
  NetworkEventsContent,
  type NetworkEventsData,
} from "./_components/network-events-content";

type Search = {
  range?: string;
  q?: string;
  vendor?: string;
  eventKind?: string;
  severity?: string;
  hostname?: string;
  srcIp?: string;
  assetId?: string;
};

export default async function NetworkEventsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) return null;

  const range = sp.range === "7d" ? "7d" : sp.range === "1h" ? "1h" : "24h";
  const q = sp.q?.trim() || "";
  const vendor = sp.vendor?.trim() || "";
  const eventKind = sp.eventKind?.trim() || "";
  const severity = sp.severity?.trim() || "";
  const hostname = sp.hostname?.trim() || "";
  const srcIp = sp.srcIp?.trim() || "";
  const assetId = sp.assetId?.trim() || "";

  const since =
    range === "1h"
      ? subHours(new Date(), 1)
      : range === "7d"
        ? subDays(new Date(), 7)
        : subHours(new Date(), 24);

  // Base filter for initial SSR query
  const baseWhere: Prisma.TEventLogNetworkWhereInput = {
    eventTime: { gte: since },
    agent: { revokedAt: null },
    ...(vendor ? { vendor } : {}),
    ...(eventKind ? { eventKind } : {}),
    ...(severity ? { severity } : {}),
    ...(hostname ? { hostname } : {}),
    ...(srcIp ? { srcIp } : {}),
    ...(assetId ? { assetId } : {}),
  };

  // Build search filters (date parse + tokens)
  const andClauses: Prisma.TEventLogNetworkWhereInput[] = [];
  const dateRange = parseDateFromQuery(q);
  if (dateRange) andClauses.push({ eventTime: dateRange });
  if (q) {
    const textQuery = q
      .replace(/\b\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\b/g, "")
      .replace(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}\b/g, "")
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "")
      .trim();
    if (textQuery) {
      andClauses.push({
        OR: [
          { description: { contains: textQuery, mode: "insensitive" } },
          { hostname: { contains: textQuery, mode: "insensitive" } },
          { interface: { contains: textQuery, mode: "insensitive" } },
          { srcIp: { contains: textQuery } },
          { vendor: { contains: textQuery, mode: "insensitive" } },
          { eventKind: { contains: textQuery, mode: "insensitive" } },
        ],
      });
    }
  }

  const where: Prisma.TEventLogNetworkWhereInput = {
    ...baseWhere,
    ...(andClauses.length > 0 ? { AND: andClauses } : {}),
  };

  const [rawEvents, total] = await Promise.all([
    prisma.tEventLogNetwork.findMany({
      where,
      orderBy: { eventTime: "desc" },
      take: 500,
      select: {
        id: true,
        eventTime: true,
        severity: true,
        rawSeverity: true,
        vendor: true,
        hostname: true,
        srcIp: true,
        inventoryMgmtIp: true,
        eventKind: true,
        interface: true,
        sourceMac: true,
        vlan: true,
        aclRule: true,
        bgpNeighborIp: true,
        description: true,
        rawData: true,
        count: true,
        assetId: true,
        agent: { select: { name: true, hostname: true, ip: true } },
        asset: {
          select: {
            id: true,
            hostname: true,
            displayName: true,
            vendor: true,
            model: true,
            mgmtIp: true,
          },
        },
      },
    }),
    prisma.tEventLogNetwork.count({ where: baseWhere }),
  ]);

  const events = rawEvents.slice(0, 100).map((e) => ({
    id: e.id,
    eventTime: e.eventTime.toISOString(),
    timestamp: e.eventTime.toISOString().slice(0, 19).replace("T", " "),
    severity: e.severity as "INFO" | "WARN" | "ERROR" | "CRITICAL",
    rawSeverity: e.rawSeverity,
    vendor: e.vendor as "cisco" | "mikrotik" | "fortinet" | "generic",
    hostname: e.hostname,
    srcIp: e.srcIp,
    inventoryMgmtIp: e.inventoryMgmtIp,
    eventKind: e.eventKind as any,
    interface: e.interface,
    sourceMac: e.sourceMac,
    vlan: e.vlan,
    aclRule: e.aclRule,
    bgpNeighborIp: e.bgpNeighborIp,
    description: e.description,
    rawData: e.rawData,
    count: e.count,
    assetId: e.assetId,
    agent_name: e.agent?.name ?? null,
    device_label: e.asset?.displayName ?? e.hostname ?? e.srcIp,
    inventoryLinked: !!e.assetId,
    agent: e.agent,
    asset: e.asset,
  }));

  // Counters (on the base-filtered set, not status-filtered)
  const vendorCounts: Record<string, number> = {};
  const kindCounts: Record<string, number> = {};
  const deviceCounts: Record<string, number> = {};
  const interfaceCounts: Record<string, number> = {};
  const severityCounts: Record<string, number> = {};
  let aclDenyCount = 0;
  let authFailCount = 0;
  let linkDownCount = 0;
  let configChangeCount = 0;
  for (const e of rawEvents) {
    vendorCounts[e.vendor] = (vendorCounts[e.vendor] ?? 0) + 1;
    kindCounts[e.eventKind] = (kindCounts[e.eventKind] ?? 0) + 1;
    const devKey = e.asset?.displayName ?? e.hostname ?? e.srcIp;
    deviceCounts[devKey] = (deviceCounts[devKey] ?? 0) + 1;
    if (e.interface) interfaceCounts[e.interface] = (interfaceCounts[e.interface] ?? 0) + 1;
    severityCounts[e.severity] = (severityCounts[e.severity] ?? 0) + 1;
    if (e.eventKind === "acl") aclDenyCount++;
    if (e.eventKind === "auth" && e.severity === "ERROR") authFailCount++;
    if (e.eventKind === "link" && e.severity !== "INFO") linkDownCount++;
    if (e.eventKind === "config-change") configChangeCount++;
  }

  const topN = (counts: Record<string, number>, n: number) =>
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([value, count]) => ({ value, label: value, count }));

  // Cast to NetworkEvent[]: shape is correct, the literal-union types
  // in the destination are slightly stricter than Prisma returns (no drift
  // in practice — values come from the DB enum).
  const eventsForInitial = events as unknown as NetworkEventsData["events"];
  const initialData: NetworkEventsData = {
    events: eventsForInitial,
    total,
    displayed: eventsForInitial.length,
    range,
    q,
    hideRevoked: true,
    vendorCounts,
    kindCounts,
    deviceCounts,
    interfaceCounts,
    severityCounts,
    aclDenyCount,
    authFailCount,
    linkDownCount,
    configChangeCount,
    topDevices: topN(deviceCounts, 5),
    topInterfaces: topN(interfaceCounts, 5),
    vendorOptions: topN(vendorCounts, 4),
    kindOptions: topN(kindCounts, 10),
    severityOptions: ["ERROR", "WARN", "INFO"]
      .map((s) => ({ value: s, label: s, count: severityCounts[s] ?? 0 }))
      .filter((s) => s.count > 0),
    filters: {
      vendor: vendor || undefined,
      eventKind: eventKind || undefined,
      severity: severity || undefined,
      hostname: hostname || undefined,
      srcIp: srcIp || undefined,
      assetId: assetId || undefined,
    },
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Network Events
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Syslog dari network devices (Cisco / MikroTik / Fortinet / generic)
            yang dikirim ke UDP/514 agent. Asset-link otomatis ke inventory
            berdasarkan mgmtIp.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <Link
            href="/dashboard/events/syslog"
            className="text-[var(--muted-foreground)] hover:text-[var(--accent)] transition-colors"
          >
            ← Syslog
          </Link>
          <Link
            href="/dashboard/endpoints/network"
            className="text-[var(--muted-foreground)] hover:text-[var(--accent)] transition-colors"
          >
            Devices →
          </Link>
        </div>
      </div>

      {/* Vendor quick stat strip */}
      <VendorStatStrip counts={vendorCounts} activeVendor={vendor} />

      {/* Active filter banner */}
      {(vendor || eventKind || severity || hostname || srcIp || assetId || q) && (
        <div className="flex items-center justify-between p-3 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5">
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <Filter className="h-3.5 w-3.5" />
            <span>
              Filter aktif:{" "}
              <span className="text-zinc-100 font-mono">
                {vendor && `vendor=${vendor}`}
                {eventKind && ` kind=${eventKind}`}
                {severity && ` sev=${severity}`}
                {hostname && ` device=${hostname}`}
                {srcIp && ` ip=${srcIp}`}
                {assetId && ` asset=${assetId}`}
                {q && ` q="${q}"`}
              </span>
            </span>
          </div>
          <Link
            href="/dashboard/events/network"
            className="text-xs text-[var(--muted-foreground)] hover:text-[var(--accent)] transition-colors"
          >
            ✕ Clear filter
          </Link>
        </div>
      )}

      <NetworkEventsContent initialData={initialData} />
    </div>
  );
}

function VendorStatStrip({
  counts,
  activeVendor,
}: {
  counts: Record<string, number>;
  activeVendor: string;
}) {
  const VENDOR_META: Record<string, { label: string; color: string; icon: any }> = {
    cisco: { label: "Cisco", color: "#049fd9", icon: Router },
    mikrotik: { label: "MikroTik", color: "#293239", icon: Radio },
    fortinet: { label: "Fortinet", color: "#da291c", icon: Shield },
    generic: { label: "Generic", color: "#71717a", icon: Network },
  };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
      <Link
        href="/dashboard/events/network"
        className={`flex flex-col items-center gap-1 p-3 rounded-lg border transition-all hover:scale-[1.02] ${
          !activeVendor
            ? "border-[var(--accent)] bg-[var(--accent)]/10"
            : "border-[var(--border)] bg-[var(--card)]/50 hover:border-[var(--accent)]/50"
        }`}
      >
        <span className="text-xl font-bold text-zinc-100">{total}</span>
        <span className="text-[10px] text-[var(--muted-foreground)] uppercase tracking-wider">All</span>
      </Link>
      {(["cisco", "mikrotik", "fortinet", "generic"] as const).map((v) => {
        const meta = VENDOR_META[v];
        const count = counts[v] ?? 0;
        const Icon = meta.icon;
        const isActive = activeVendor === v;
        return (
          <Link
            key={v}
            href={`/dashboard/events/network?vendor=${v}`}
            className={`flex flex-col items-center gap-1 p-3 rounded-lg border transition-all hover:scale-[1.02] ${
              isActive
                ? "border-[var(--accent)] bg-[var(--accent)]/10"
                : "border-[var(--border)] bg-[var(--card)]/50 hover:border-[var(--accent)]/50"
            } ${count === 0 ? "opacity-40" : ""}`}
            title={`${meta.label} events (${count})`}
          >
            <Icon className="h-4 w-4" style={{ color: isActive ? "var(--accent)" : meta.color }} />
            <span className="text-lg font-bold text-zinc-100">{count}</span>
            <span className="text-[10px] text-[var(--muted-foreground)] uppercase tracking-wider">{meta.label}</span>
          </Link>
        );
      })}
    </div>
  );
}