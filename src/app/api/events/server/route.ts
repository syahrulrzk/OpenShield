/**
 * /api/events/server — list server events with filters (JSON)
 *
 * GET /api/events/server?q=<text>&status=<SUCCESS|FAILED|DENIED>&range=<1h|24h|7d>
 *
 * Mirrors the data layer from src/app/dashboard/server/page.tsx but
 * returns JSON for client-side fetching (live search, no full page reload).
 *
 * Auth: session check (RBAC) — same as the page.
 * Search: matches against message, source, rawData.user, rawData.ip,
 *         and parses ISO/id-ID dates from `q` to filter eventTime.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/security/rbac";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { subHours, subDays } from "date-fns";
import { parseDateFromQuery, parseIpFromQuery } from "@/lib/search/query-parsers";
import { groupBySession, type RawServerAuthRow } from "@/lib/server-auth-grouping";

// Server Auth sources — login/auth-related logs only.
// Syslog goes to /dashboard/events/syslog (see SYSLOG_SOURCES below).
// Web server access/error logs stay here as a temporary home until the
// Apps sub-page is built (they're not auth, but no other home yet).
const SERVER_SOURCES = [
  "/var/log/auth.log",
  "/var/log/secure",
  "/var/log/sudo.log",
  "/var/log/cron.log",
  "/var/log/nginx/access.log",
  "/var/log/nginx/error.log",
  "/var/log/apache2/access.log",
  "/var/log/apache2/error.log",
] as const;

// Subsets used by sub-pages under /dashboard/events/* so each page can
// scope its queries without rebuilding the route from scratch.
const SYSLOG_SOURCES = [
  "/var/log/syslog",
  "/var/log/messages",
  "/var/log/syslog.1",
  "/var/log/messages.1",
] as const;

// FIM (File Integrity Monitoring) events don't match by source path —
// they're identified by eventType=file.change (source IS the file path).
// Returning a sentinel lets SOURCE_TYPE_MAP carry a hint without forcing
// every source to be in some allowlist.
const FIM_SENTINEL = "__FIM__" as const;

const SOURCE_TYPE_MAP: Record<string, readonly string[] | typeof FIM_SENTINEL> = {
  syslog: SYSLOG_SOURCES,
  fim: FIM_SENTINEL,
};

function isServerEvent(source: string): boolean {
  return SERVER_SOURCES.some((s) => source === s || source.endsWith(s));
}

type EventStatus = "SUCCESS" | "FAILED" | "DENIED";

function getEventStatus(severity: string, message: string): EventStatus {
  const lower = message.toLowerCase();
  if (/\b(den(y|ied)|blocked|refused|not\s+allowed|rejected)\b/i.test(lower)) {
    return "DENIED";
  }
  if (/\b(fail(ed|ure)?|invalid|unsuccessful|wrong|incorrect)\b/i.test(lower)) {
    return "FAILED";
  }
  if (
    /\b(ok|accept(ed)?|success(ful)?|logged\s+in|signed\s+in|authenticated)\b/i.test(
      lower,
    )
  ) {
    return "SUCCESS";
  }
  if (severity === "INFO") return "SUCCESS";
  if (severity === "ERROR" || severity === "CRITICAL") {
    return "FAILED";
  }
  return "FAILED";
}

// Note: date/IP query parsing lives in @/lib/search/query-parsers so it can
// be shared between this API route and the Server Component page.

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const range = sp.get("range") || "24h";
  const q = sp.get("q")?.trim() || "";
  const statusParam = (sp.get("status") || "all").toUpperCase();
  const statusFilter: EventStatus | undefined = [
    "SUCCESS",
    "FAILED",
    "DENIED",
  ].includes(statusParam)
    ? (statusParam as EventStatus)
    : undefined;
  // Audit trail pattern (SOC 2 / ISO 27001): by default, hide events from
  // agents that have been revoked (soft-deleted via revokedAt). The events
  // themselves remain in the DB for forensic/audit purposes — we just don't
  // show them in the live operational view. Admins can opt-in via ?hideRevoked=0.
  const hideRevoked = sp.get("hideRevoked") !== "0";
  // 2026-06-21: hide low-signal `sshd.connection` events by default — they're
  // pure connection metadata (IP:PORT handshake, no auth result) and get
  // immediately followed by the higher-signal `sshd.accepted` / `sshd.failed`
  // event from the same session. Hiding them by default cuts noise ~3×.
  // Opt-in via ?showConnection=1 to see all connection metadata.
  const showConnection = sp.get("showConnection") === "1";
  // 2026-06-22: noise filter for syslog page — mirror the page.tsx logic.
  // Agent already filters noise sources (systemd/dockerd/etc) so we only
  // need a few remaining patterns as opt-out fallback. ?showNoise=1 to opt-in.
  const showNoise = sp.get("showNoise") === "1";
  const noisePatterns = [
    "Heartbeat OK",
    "Skip /var/log/",
    "POST /api/agents/heartbeat",
    "raw_params=", // agent edit tool debug (truncated JSON)
    "[context-overflow-", // agent context overflow msg
    "node[", // next.js dev mode
  ];
  // Sub-page source scoping: e.g. /dashboard/events/syslog sets ?sourceType=syslog
  // so the API filters to only syslog sources. Unknown values fall through to
  // the full SERVER_SOURCES list (current behaviour).
  const sourceType = sp.get("sourceType") || "";
  const scopedSources = SOURCE_TYPE_MAP[sourceType];

  // ─────────────────────────────────────────────────────────────────────
  // 2026-06-22: USER / AGENT / PORT quick filters (URL params).
  // Distinct values are passed to the dropdown UI; the filter narrows the
  // query when set. For syslog: user = syslog.user column; port = syslog.port.
  // Agent filter narrows by denormalized agent_name (avoids JOIN + matches
  // SSR page.tsx logic).
  // ─────────────────────────────────────────────────────────────────────
  const userFilter = sp.get("user")?.trim() || "";
  const agentFilter = sp.get("agent")?.trim() || "";
  const portFilter = sp.get("port")?.trim() || "";

  // ─────────────────────────────────────────────────────────────────────
  // 2026-06-22: Category filter (auth/service/cron/network/...)
  // Maps UI-friendly category name → set of eventType prefixes that the
  // agent's SyslogParser emits. Applied only to syslog queries (other
  // event types don't have categories yet).
  // ─────────────────────────────────────────────────────────────────────
  const category = sp.get("category") || "";
  const CATEGORY_PREFIXES: Record<string, string[]> = {
    auth:     ["syslog.sshd", "syslog.sudo", "syslog.su", "syslog.pam", "syslog.privilege", "syslog.session"],
    user:     ["syslog.user_change"],
    service:  ["syslog.service"],
    cron:     ["syslog.cron"],
    network:  ["syslog.network", "syslog.firewall"],
    docker:   ["syslog.docker", "syslog.kubernetes"],
    disk:     ["syslog.disk"],
    hardware: ["syslog.usb", "syslog.hardware"],
    kernel:   ["syslog.kernel"],
    package:  ["syslog.package"],
    system:   ["syslog.line", "syslog.malformed"],
  };
  const categoryPrefixes = CATEGORY_PREFIXES[category] || null;

  // Time window — but if the user searches by date (in `q`), use a generous
  // window instead of the user-selected `range`. Otherwise the 24h range
  // would exclude earlier events that match the date filter.
  const hasDateInQuery = !!parseDateFromQuery(q);
  const since =
    hasDateInQuery
      ? subDays(new Date(), 365) // generous fallback for date searches
      : range === "1h"
        ? subHours(new Date(), 1)
        : range === "7d"
          ? subDays(new Date(), 7)
          : subDays(new Date(), 1);

  // 2026-06-21 refactor: agentEvent table split into 6 per-type tables.
  // This endpoint serves server_auth events (sshd + sudo + nginx/apache auth).
  // Other source types (syslog/fim) have their own sub-pages now.
  // We dispatch to the right table based on scopedSources.
  const isFimOnly = scopedSources === FIM_SENTINEL;

  // Field-path filters still need rawData JSONB access — those go to the
  // tEventLogServerAuth table for sshd events (rawData has ip/user/event).
  // For now, we query tEventLogServerAuth (the unified sshd+auth table).
  const baseWhere: Prisma.TEventLogServerAuthWhereInput = {
    eventTime: { gte: since },
    ...(hideRevoked ? { agent: { revokedAt: null } } : {}),
    // Hide low-signal sshd.connection events. They have no user/result, only
    // connection metadata. The corresponding sshd.accepted/sshd.failed row
    // from the same session carries the actual auth result.
    ...(showConnection ? {} : {
      NOT: { raw: { contains: "|sshd.connection" } },
    }),
  };

  // Build search filters (date / IP / text → user/ip/message/source)
  const andClauses: Prisma.TEventLogServerAuthWhereInput[] = [];
  const dateRange = parseDateFromQuery(q);
  if (dateRange) andClauses.push({ eventTime: dateRange });
  const ipMatch = parseIpFromQuery(q);
  if (ipMatch) {
    andClauses.push({
      OR: [
        { sourceIp: { contains: ipMatch } },
        { raw: { contains: ipMatch } },
      ],
    });
  }
  // Text search across raw (was message), sourceIp, username
  if (q) {
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
            case "agent":
              andClauses.push({
                OR: [
                  { agent: { name: { contains: v, mode: "insensitive" } } },
                  { agent: { hostname: { contains: v, mode: "insensitive" } } },
                ],
              });
              break;
            case "user":
            case "username":
              andClauses.push({ username: { contains: v, mode: "insensitive" } });
              break;
            case "ip":
              andClauses.push({
                OR: [
                  { sourceIp: { contains: v } },
                  { raw: { contains: v } },
                ],
              });
              break;
            case "msg":
            case "message":
              andClauses.push({ raw: { contains: v, mode: "insensitive" } });
              break;
            default:
              andClauses.push({
                OR: [
                  { raw: { contains: token, mode: "insensitive" } },
                  { username: { contains: token, mode: "insensitive" } },
                  { sourceIp: { contains: token } },
                  { agent: { name: { contains: token, mode: "insensitive" } } },
                  { agent: { hostname: { contains: token, mode: "insensitive" } } },
                ],
              });
          }
        } else {
          andClauses.push({
            OR: [
              { raw: { contains: token, mode: "insensitive" } },
              { username: { contains: token, mode: "insensitive" } },
              { sourceIp: { contains: token } },
              { agent: { name: { contains: token, mode: "insensitive" } } },
              { agent: { hostname: { contains: token, mode: "insensitive" } } },
            ],
          });
        }
      }
    }
  }
  const where: Prisma.TEventLogServerAuthWhereInput = {
    ...baseWhere,
    ...(andClauses.length > 0 ? { AND: andClauses } : {}),
  };

  // Skip FIM queries on this endpoint — they should hit /api/events/fim
  if (isFimOnly) {
    return NextResponse.json({
      events: [],
      total: 0,
      displayed: 0,
      filteredTotal: 0,
      statusCounts: { SUCCESS: 0, FAILED: 0, DENIED: 0 },
      statusFilter: statusFilter ?? "all",
      range,
      q,
      hideRevoked,
      note: "FIM events have their own endpoint — see /api/events/fim",
    });
  }

  // 2026-06-22: Dispatch to tEventLogSyslog when sourceType=syslog.
  // The syslog table has different columns (no username/sourceIp — those
  // live in raw_data.user/raw_data.ip). The UI consumes both via
  // rawData so we normalize the shape here.
  const isSyslogOnly = sourceType === "syslog";
  if (isSyslogOnly) {
    const andClauses2: Prisma.TEventLogSyslogWhereInput[] = [];
    const dateRange2 = parseDateFromQuery(q);
    if (dateRange2) andClauses2.push({ eventTime: dateRange2 });
    const ipMatch2 = parseIpFromQuery(q);
    if (ipMatch2) {
      andClauses2.push({
        OR: [
          { hostname: { contains: ipMatch2 } },
          { description: { contains: ipMatch2 } },
          { sourceIp: { contains: ipMatch2 } },
        ],
      });
    }
    if (q) {
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
              case "agent":
                andClauses2.push({
                  OR: [
                    { agent: { name: { contains: v, mode: "insensitive" } } },
                    { agent: { hostname: { contains: v, mode: "insensitive" } } },
                  ],
                });
                break;
              case "user":
                andClauses2.push({ user: { contains: v, mode: "insensitive" } });
                break;
              case "ip":
                andClauses2.push({
                  OR: [
                    { hostname: { contains: v } },
                    { description: { contains: v } },
                    { sourceIp: { contains: v } },
                  ],
                });
                break;
              case "msg":
              case "message":
                andClauses2.push({ description: { contains: v, mode: "insensitive" } });
                break;
              default:
                andClauses2.push({
                  OR: [
                    { description: { contains: token, mode: "insensitive" } },
                    { source: { contains: token, mode: "insensitive" } },
                    { process: { contains: token, mode: "insensitive" } },
                    { hostname: { contains: token, mode: "insensitive" } },
                  ],
                });
            }
          } else {
            andClauses2.push({
              OR: [
                { description: { contains: token, mode: "insensitive" } },
                { source: { contains: token, mode: "insensitive" } },
                { process: { contains: token, mode: "insensitive" } },
                { hostname: { contains: token, mode: "insensitive" } },
              ],
            });
          }
        }
      }
    }

    const baseWhere2: Prisma.TEventLogSyslogWhereInput = {
      eventTime: { gte: since },
      source: { in: [...SYSLOG_SOURCES] },
      ...(hideRevoked ? { agent: { revokedAt: null } } : {}),
      ...(!showNoise
        ? {
            NOT: noisePatterns.map((p) => ({
              description: { contains: p },
            })) as Prisma.TEventLogSyslogWhereInput[],
          }
        : {}),
      // 2026-06-22: category filter (eventType prefix match via OR chain)
      ...(categoryPrefixes
        ? { eventType: { in: categoryPrefixes } }
        : {}),
      // 2026-06-22: USER / AGENT / PORT quick filters (URL params).
      // When set, narrow the base query before AND search clauses run.
      ...(userFilter ? { user: { equals: userFilter } } : {}),
      ...(agentFilter ? { agentName: { equals: agentFilter } } : {}),
      ...(portFilter ? { port: { equals: parseInt(portFilter, 10) } } : {}),
    };
    const where2: Prisma.TEventLogSyslogWhereInput = {
      ...baseWhere2,
      ...(andClauses2.length > 0 ? { AND: andClauses2 } : {}),
    };

    const [rawEvents2, total2] = await Promise.all([
      // 2026-06-22: keep query to base table (Prisma where) for safety +
      // structured filters. Post-process rows to match the flat view shape:
      //   id, timestamp, agent, event_type, severity, user, source_ip, description
      prisma.tEventLogSyslog.findMany({
        where: where2,
        orderBy: { eventTime: "desc" },
        take: 500,
        select: {
          id: true,
          eventTime: true,
          eventType: true,
          severity: true,
          user: true,
          sourceIp: true,
          description: true,
          source: true,
          process: true,
          hostname: true,
          agentName: true,
          authDetected: true,
          facility: true,
          priority: true,
          service: true,
          port: true,
          count: true,
        },
      }),
      prisma.tEventLogSyslog.count({ where: baseWhere2 }),
    ]);

    // 2026-06-22: rows from prisma.tEventLogSyslog already have flat typed
    // columns (after the 20260622081000 flatten migration). Map them to
    // the example shape Bos wants:
    //   id, timestamp, agent, event_type, severity, user, source_ip, description
    // Also synthesize a legacy `message` field so the UI helpers
    // (getEventStatus, getEventIp, getEventUser, etc.) keep working.
    const eventsWithStatus2 = rawEvents2.map((e) => {
      const eventKind = e.eventType || "log.line";
      const eventTimeIso = e.eventTime.toISOString();
      return {
        // FLAT COLUMNS — matches Bos's example
        id: e.id,
        timestamp: eventTimeIso.slice(0, 19).replace("T", " "),
        agent: e.agentName,
        agent_name: e.agentName,
        event_type: eventKind,
        severity: e.severity,
        user: e.user,
        source_ip: e.sourceIp,
        description: e.description,
        // Legacy / UI helper fields
        source: e.source,
        process: e.process,
        hostname: e.hostname,
        message: e.description,        // alias for UI
        eventTime: e.eventTime,
        auth_detected: e.authDetected,
        facility: e.facility,
        priority: e.priority,
        service: e.service,
        port: e.port,
        count: e.count,
        // Synthesize rawData for the UI's getEventKind/getEventIp helpers
        // that still read from rawData.eventKind / rawData.user / rawData.ip.
        // No actual jsonb storage anymore — this is just an in-memory shape
        // contract.
        rawData: {
          eventKind,
          user: e.user,
          ip: e.sourceIp,
          authDetected: e.authDetected,
          port: e.port,
          service: e.service,
          process: e.process,
        },
        status: getEventStatus(e.severity, e.description),
      };
    });

    const statusCounts2: Record<EventStatus, number> = {
      SUCCESS: 0,
      FAILED: 0,
      DENIED: 0,
    };
    const kindCounts2: Record<string, number> = {};
    let authCount2 = 0;
    // 2026-06-22: collect top values for USER / AGENT / PORT dropdowns.
    // Build from the raw events (pre-status-filter, post-base-filter) so
    // the options reflect what would be available if user clears status.
    const userCounts2: Record<string, number> = {};
    const agentCounts2: Record<string, number> = {};
    const portCounts2: Record<string, number> = {};
    for (const e of eventsWithStatus2) {
      statusCounts2[e.status]++;
      if (e.event_type && e.event_type.startsWith("syslog.")) {
        kindCounts2[e.event_type] = (kindCounts2[e.event_type] ?? 0) + 1;
      }
      if (e.auth_detected === true) authCount2++;
      if (e.user) userCounts2[e.user] = (userCounts2[e.user] ?? 0) + 1;
      const agentLabel = typeof e.agent === "string" ? e.agent : e.agent_name;
      if (agentLabel) agentCounts2[agentLabel] = (agentCounts2[agentLabel] ?? 0) + 1;
      if (e.port !== null && e.port !== undefined) {
        portCounts2[String(e.port)] = (portCounts2[String(e.port)] ?? 0) + 1;
      }
    }
    const topN = (counts: Record<string, number>, n: number) =>
      Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([value, count]) => ({ value, label: value, count }));

    const filtered2 = statusFilter
      ? eventsWithStatus2.filter((e) => e.status === statusFilter)
      : eventsWithStatus2;
    const events2 = filtered2.slice(0, 100);

    return NextResponse.json({
      events: events2,
      total: total2,
      displayed: events2.length,
      filteredTotal: filtered2.length,
      statusCounts: statusCounts2,
      statusFilter: statusFilter ?? "all",
      range,
      q,
      hideRevoked,
      showConnection,
      kindCounts: kindCounts2,
      authCount: authCount2,
      // 2026-06-22: dropdown filter options + currently-applied value
      userOptions: topN(userCounts2, 15),
      agentOptions: topN(agentCounts2, 10),
      portOptions: topN(portCounts2, 10),
      userFilter: userFilter || undefined,
      agentFilter: agentFilter || undefined,
      portFilter: portFilter || undefined,
    });
  }

  const [rawEvents, total] = await Promise.all([
    prisma.tEventLogServerAuth.findMany({
      where,
      orderBy: { eventTime: "desc" },
      take: 500,
      select: {
        id: true,
        username: true,
        sourceIp: true,
        status: true,
        method: true,
        country: true,
        sourceFile: true,
        sourcePort: true,
        service: true,
        raw: true,
        eventTime: true,
        count: true,
        agent: { select: { name: true, hostname: true, ip: true } },
      },
    }),
    prisma.tEventLogServerAuth.count({ where: baseWhere }),
  ]);

  // 2026-06-21 refactor: events already come from tEventLogServerAuth (auth-only).
  // No need to filter by source — the table IS the auth filter.
  // Session grouping: 1 SSH session emits 3-6 events. Group by
  // (sourceIp, sourcePort) and keep highest-priority event as primary.
  const grouped = groupBySession(rawEvents as RawServerAuthRow[]);

  // Map status directly (tEventLogServerAuth.status is ServerStatus enum).
  // Map INVALID → "DENIED" for backward compat with UI status filter.
  const eventsWithStatus = grouped.map((e) => {
    const uiStatus: "SUCCESS" | "FAILED" | "DENIED" =
      e.status === "SUCCESS" ? "SUCCESS" :
      e.status === "FAILED" ? "FAILED" :
      "DENIED"; // INVALID → DENIED for UI compat
    // Source log: prefer DB column (sourceFile = /var/log/auth.log), fallback to raw
    const source = e.sourceFile ?? "auth.log";
    // Parse port from raw line if not stored (backward compat with old rows)
    let clientPort = e.sourcePort ?? null;
    if (clientPort === null && e.raw) {
      const m = e.raw.match(/\bport\s+(\d{2,5})\b/i);
      if (m) clientPort = parseInt(m[1], 10);
    }
    return {
      id: e.id,
      eventType: "log.line",
      severity: e.status === "SUCCESS" ? "INFO" : e.status === "FAILED" ? "WARN" : "ERROR",
      source,
      message: e.raw ?? `${e.status} for ${e.username} from ${e.sourceIp}`,
      rawData: {
        username: e.username,
        ip: e.sourceIp,
        status: e.status,
        method: e.method,
        // Normalize service to UPPERCASE (SSH/SUDO/NGINX). The DB column
        // sometimes contains lowercase variants from older parsers
        // (e.g. "sshd" → "SSHD"). The UI SERVICE_META has aliases for
        // common variants (SSHD/OPENSSH → "SSH") so the user always sees
        // a consistent label. SERVICE_META lookup is case-sensitive so
        // we keep the canonical UPPERCASE form here.
        service: e.groupService ?? (
          typeof e.service === "string" && e.service.length > 0
            ? e.service.toUpperCase()
            : null
        ),
        port: clientPort,
        serverPort: clientPort !== null ? 22 : null,
        // Session grouping metadata: how many events were merged and which
        // subsession types (e.g. "sftp_session") were collapsed into this
        // primary row. UI shows "SFTP" badge + count for visibility.
        sessionEventCount: e.sessionEventCount,
        sessionSubsessions: e.sessionSubsessions,
      },
      eventTime: e.eventTime,
      count: e.count,
      agent: e.agent,
      status: uiStatus,
    };
  });

  const statusCounts: Record<EventStatus, number> = {
    SUCCESS: 0,
    FAILED: 0,
    DENIED: 0,
  };
  // 2026-06-22: Count syslog eventKind breakdown + auth events.
  // SyslogParser sets raw_data.eventKind + raw_data.authDetected.
  const kindCounts: Record<string, number> = {};
  let authCount = 0;
  for (const e of eventsWithStatus) {
    statusCounts[e.status]++;
    const rd = (e.rawData ?? {}) as Record<string, unknown>;
    const k = typeof rd.eventKind === "string" ? rd.eventKind : null;
    if (k && k.startsWith("syslog.")) {
      kindCounts[k] = (kindCounts[k] ?? 0) + 1;
    }
    if (rd.authDetected === true) authCount++;
  }

  const filtered = statusFilter
    ? eventsWithStatus.filter((e) => e.status === statusFilter)
    : eventsWithStatus;
  const events = filtered.slice(0, 100);

  return NextResponse.json({
    events,
    total,
    displayed: events.length,
    filteredTotal: filtered.length,
    statusCounts,
    statusFilter: statusFilter ?? "all",
    range,
    q,
    hideRevoked,
    showConnection,
    kindCounts,
    authCount,
  });
}
