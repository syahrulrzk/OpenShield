/**
 * /api/events/network — list network device syslog events (JSON)
 *
 * GET /api/events/network?q=<text>&range=<1h|24h|7d>
 *
 * Mirrors the data layer pattern from /api/events/syslog. Returns events
 * from t_event_log_network populated by the agent's UDP/514 receiver
 * (Cisco / MikroTik / Fortinet / generic).
 *
 * Filters:
 *   - q          : free-text search across description, hostname, srcIp,
 *                  interface, vendor, eventKind (tokens + field:value pairs)
 *   - range      : 1h | 24h | 7d
 *   - vendor     : cisco | mikrotik | fortinet | generic (exact match)
 *   - eventKind  : link | acl | bgp | auth | config-change | dhcp | ...
 *   - severity   : ERROR | WARN | INFO
 *   - hostname   : device hostname (exact)
 *   - srcIp      : source IP (exact, used by asset-link UI to filter per-device)
 *   - assetId    : linked inventory asset (exact)
 *   - hideRevoked: 1 (default) hides events from agents that have been
 *                  soft-deleted (revokedAt != null). 0 to opt-in to all.
 *
 * Auth: session check (RBAC) — same as syslog/server route.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/security/rbac";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { subHours, subDays } from "date-fns";
import { parseDateFromQuery } from "@/lib/search/query-parsers";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const range = sp.get("range") || "24h";
  const q = sp.get("q")?.trim() || "";
  const vendor = sp.get("vendor")?.trim() || "";
  const eventKind = sp.get("eventKind")?.trim() || "";
  const severity = sp.get("severity")?.trim() || "";
  const hostname = sp.get("hostname")?.trim() || "";
  const srcIp = sp.get("srcIp")?.trim() || "";
  const assetId = sp.get("assetId")?.trim() || "";
  const hideRevoked = sp.get("hideRevoked") !== "0";

  // Time window — generous fallback when date appears in `q`.
  const hasDateInQuery = !!parseDateFromQuery(q);
  const since =
    hasDateInQuery
      ? subDays(new Date(), 365)
      : range === "1h"
        ? subHours(new Date(), 1)
        : range === "7d"
          ? subDays(new Date(), 7)
          : subDays(new Date(), 1);

  // Base where — exact-match filters + window + agent filter
  const baseWhere: Prisma.TEventLogNetworkWhereInput = {
    eventTime: { gte: since },
    ...(hideRevoked ? { agent: { revokedAt: null } } : {}),
    ...(vendor ? { vendor } : {}),
    ...(eventKind ? { eventKind } : {}),
    ...(severity ? { severity } : {}),
    ...(hostname ? { hostname } : {}),
    ...(srcIp ? { srcIp } : {}),
    ...(assetId ? { assetId } : {}),
  };

  // Search filters from `q` (date parse + tokens with field:value support)
  const andClauses: Prisma.TEventLogNetworkWhereInput[] = [];
  const dateRange = parseDateFromQuery(q);
  if (dateRange) andClauses.push({ eventTime: dateRange });
  // Strip date + IP tokens from q before token search
  const stripped = q
    .replace(/\b\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\b/g, "")
    .replace(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}\b/g, "")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "")
    .trim();
  if (stripped) {
    const tokens = stripped.split(/\s+/).filter((t) => t.length > 0);
    for (const token of tokens) {
      const fieldMatch = token.match(/^([a-zA-Z]+):(.+)$/);
      if (fieldMatch) {
        const [, field, value] = fieldMatch;
        const v = value.trim();
        if (!v) continue;
        switch (field.toLowerCase()) {
          case "vendor":
            andClauses.push({ vendor: { contains: v, mode: "insensitive" } });
            break;
          case "kind":
            andClauses.push({ eventKind: { contains: v, mode: "insensitive" } });
            break;
          case "device":
          case "host":
            andClauses.push({ hostname: { contains: v, mode: "insensitive" } });
            break;
          case "ip":
            andClauses.push({ srcIp: { contains: v } });
            break;
          case "interface":
          case "intf":
            andClauses.push({ interface: { contains: v, mode: "insensitive" } });
            break;
          case "msg":
          case "message":
            andClauses.push({ description: { contains: v, mode: "insensitive" } });
            break;
          case "sev":
          case "severity":
            andClauses.push({ severity: { equals: v.toUpperCase() } });
            break;
          case "agent":
            andClauses.push({
              OR: [
                { agent: { name: { contains: v, mode: "insensitive" } } },
                { agent: { hostname: { contains: v, mode: "insensitive" } } },
              ],
            });
            break;
          default:
            andClauses.push({
              OR: [
                { description: { contains: token, mode: "insensitive" } },
                { hostname: { contains: token, mode: "insensitive" } },
                { srcIp: { contains: token } },
                { interface: { contains: token, mode: "insensitive" } },
                { vendor: { contains: token, mode: "insensitive" } },
                { eventKind: { contains: token, mode: "insensitive" } },
                { agent: { name: { contains: token, mode: "insensitive" } } },
                { agent: { hostname: { contains: token, mode: "insensitive" } } },
              ],
            });
        }
      } else {
        andClauses.push({
          OR: [
            { description: { contains: token, mode: "insensitive" } },
            { hostname: { contains: token, mode: "insensitive" } },
            { srcIp: { contains: token } },
            { interface: { contains: token, mode: "insensitive" } },
            { vendor: { contains: token, mode: "insensitive" } },
            { eventKind: { contains: token, mode: "insensitive" } },
            { agent: { name: { contains: token, mode: "insensitive" } } },
            { agent: { hostname: { contains: token, mode: "insensitive" } } },
          ],
        });
      }
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
        agentId: true,
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

  // Shape rows for the UI. Flatten typed cols + keep rawData for details panel.
  const events = rawEvents.map((e) => ({
    id: e.id,
    eventTime: e.eventTime,
    timestamp: e.eventTime.toISOString().slice(0, 19).replace("T", " "),
    severity: e.severity,
    rawSeverity: e.rawSeverity,
    vendor: e.vendor,
    hostname: e.hostname,
    srcIp: e.srcIp,
    inventoryMgmtIp: e.inventoryMgmtIp,
    eventKind: e.eventKind,
    interface: e.interface,
    sourceMac: e.sourceMac,
    vlan: e.vlan,
    aclRule: e.aclRule,
    bgpNeighborIp: e.bgpNeighborIp,
    description: e.description,
    rawData: e.rawData,
    count: e.count,
    assetId: e.assetId,
    agent: e.agent,
    asset: e.asset,
    agent_name: e.agent?.name ?? null,
    device_label: e.asset?.displayName ?? e.hostname ?? e.srcIp,
    inventoryLinked: !!e.assetId,
  }));

  // Breakdown counters for the header chips + side cards.
  // Pre-compute counts on the BASE where (not filtered by status) so the
  // counts reflect what would show if user clears all chips.
  const vendorCounts: Record<string, number> = {};
  const kindCounts: Record<string, number> = {};
  const deviceCounts: Record<string, number> = {};
  const interfaceCounts: Record<string, number> = {};
  const severityCounts: Record<string, number> = {};
  let aclDenyCount = 0;
  let authFailCount = 0;
  let linkDownCount = 0;
  let configChangeCount = 0;
  for (const e of events) {
    vendorCounts[e.vendor] = (vendorCounts[e.vendor] ?? 0) + 1;
    kindCounts[e.eventKind] = (kindCounts[e.eventKind] ?? 0) + 1;
    const devKey = e.device_label ?? "unknown";
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

  return NextResponse.json({
    events,
    total,
    displayed: events.length,
    range,
    q,
    hideRevoked,
    // Counts for chips + side cards
    vendorCounts,
    kindCounts,
    deviceCounts,
    interfaceCounts,
    severityCounts,
    // Side card summaries
    aclDenyCount,
    authFailCount,
    linkDownCount,
    configChangeCount,
    // Top-N lists for filter dropdowns / side cards
    topDevices: topN(deviceCounts, 5),
    topInterfaces: topN(interfaceCounts, 5),
    vendorOptions: topN(vendorCounts, 4),
    kindOptions: topN(kindCounts, 10),
    severityOptions: ["ERROR", "WARN", "INFO"]
      .map((s) => ({ value: s, label: s, count: severityCounts[s] ?? 0 }))
      .filter((s) => s.count > 0),
    // Applied filters echo
    filters: {
      vendor: vendor || undefined,
      eventKind: eventKind || undefined,
      severity: severity || undefined,
      hostname: hostname || undefined,
      srcIp: srcIp || undefined,
      assetId: assetId || undefined,
    },
  });
}