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

// Server-side log paths (everything except SSH login auth.log/secure)
const SERVER_SOURCES = [
  "/var/log/syslog",
  "/var/log/messages",
  "/var/log/kern.log",
  "/var/log/dmesg",
  "/var/log/auth.log", // kept here too — SSH is filtered at display time
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

const SOURCE_TYPE_MAP: Record<string, readonly string[]> = {
  syslog: SYSLOG_SOURCES,
  // future: apps, auditd, fim — each gets its own subset
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
  // Sub-page source scoping: e.g. /dashboard/events/syslog sets ?sourceType=syslog
  // so the API filters to only syslog sources. Unknown values fall through to
  // the full SERVER_SOURCES list (current behaviour).
  const sourceType = sp.get("sourceType") || "";
  const scopedSources = SOURCE_TYPE_MAP[sourceType];

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

  // Base WHERE — audit trail: by default exclude events from revoked agents.
  // Admins can opt-in to seeing them via ?hideRevoked=0 (rare, for forensics).
  // If sourceType is set (e.g. "syslog"), restrict source to the subset.
  const baseWhere: Prisma.AgentEventWhereInput = {
    eventType: "log.line",
    eventTime: { gte: since },
    ...(scopedSources ? { source: { in: [...scopedSources] } } : {}),
    ...(hideRevoked ? { agent: { revokedAt: null } } : {}),
  };

  // Build search filters (date / IP / text → user/ip/message/source)
  const andClauses: Prisma.AgentEventWhereInput[] = [];
  const dateRange = parseDateFromQuery(q);
  if (dateRange) andClauses.push({ eventTime: dateRange });
  const ipMatch = parseIpFromQuery(q);
  if (ipMatch) {
    andClauses.push({
      rawData: { path: ["ip"], string_contains: ipMatch },
    });
  }
  // Text search across message/source/user — skip if q is purely a date or IP
  // (the dateRange/ipMatch filter alone is sufficient and the text-search OR
  // would otherwise exclude everything when q doesn't appear in any field).
  if (q) {
    // Strip dates and IPs from q — they're handled by dedicated filters
    // (dateRange above + ipMatch above). Otherwise the text-search OR would
    // exclude everything when "2026-06-19" doesn't appear in message/source/user.
    const stripped = q
      .replace(/\b\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\b/g, "")
      .replace(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}\b/g, "")
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "")
      .trim();

    // Tokenize: each whitespace-separated token becomes one AND clause with
    // internal OR (matches any searchable field). Supports `field:value` prefix
    // to scope a token to a specific field.
    //
    // Examples:
    //   "ucok"                     → matches ucok in any field
    //   "dev_cona ucok"            → matches events that have BOTH dev_cona
    //                                AND ucok somewhere in searchable fields
    //   "agent:dev_cona user:ucok" → strict: agent.name AND rawData.user
    //   "agent:linux-host failed"  → from linux-host AND message/source/...
    //                                contains "failed"
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
            andClauses.push({
              OR: [
                { rawData: { path: ["user"], string_contains: v } },
                { rawData: { path: ["username"], string_contains: v } },
              ],
            });
            break;
          case "source":
            andClauses.push({ source: { contains: v, mode: "insensitive" } });
            break;
          case "service":
            // Matches rawData.service exactly (case-insensitive) so the user can
            // search e.g. `service:SFTP` or `service:ssh`. Falls back to a contains
            // on rawData.service in case the field is unset/typed differently.
            andClauses.push({
              rawData: { path: ["service"], string_contains: v },
            });
            // Also try common field name variants
            andClauses.push({
              OR: [
                { rawData: { path: ["service"], equals: v.toUpperCase() } },
                { rawData: { path: ["service"], equals: v.toLowerCase() } },
              ],
            });
            break;
          case "msg":
          case "message":
            andClauses.push({ message: { contains: v, mode: "insensitive" } });
            break;
          case "ip":
            andClauses.push({
              OR: [
                { rawData: { path: ["ip"], string_contains: v } },
                { message: { contains: v } },
              ],
            });
            break;
          default:
            // Unknown field prefix → fall through to generic OR
            andClauses.push({
              OR: [
                { message: { contains: token, mode: "insensitive" } },
                { source: { contains: token, mode: "insensitive" } },
                { rawData: { path: ["user"], string_contains: token } },
                { rawData: { path: ["username"], string_contains: token } },
                { rawData: { path: ["service"], string_contains: token } },
                { agent: { name: { contains: token, mode: "insensitive" } } },
                { agent: { hostname: { contains: token, mode: "insensitive" } } },
              ],
            });
        }
      } else {
        // No field prefix → match against any searchable field
        andClauses.push({
          OR: [
            { message: { contains: token, mode: "insensitive" } },
            { source: { contains: token, mode: "insensitive" } },
            { rawData: { path: ["user"], string_contains: token } },
            { rawData: { path: ["username"], string_contains: token } },
            { rawData: { path: ["service"], string_contains: token } },
            { agent: { name: { contains: token, mode: "insensitive" } } },
            { agent: { hostname: { contains: token, mode: "insensitive" } } },
          ],
        });
      }
    }
  }
  const where: Prisma.AgentEventWhereInput = {
    ...baseWhere,
    ...(andClauses.length > 0 ? { AND: andClauses } : {}),
  };

  const [rawEvents, total] = await Promise.all([
    prisma.agentEvent.findMany({
      where,
      orderBy: { eventTime: "desc" },
      take: 500,
      select: {
        id: true,
        eventType: true,
        severity: true,
        source: true,
        message: true,
        rawData: true,
        eventTime: true,
        count: true,
        agent: { select: { name: true, hostname: true, ip: true } },
      },
    }),
    prisma.agentEvent.count({ where: baseWhere }),
  ]);

  const serverEvents = rawEvents.filter((e) => isServerEvent(e.source));
  const eventsWithStatus = serverEvents.map((e) => ({
    ...e,
    status: getEventStatus(e.severity, e.message),
  }));

  const statusCounts: Record<EventStatus, number> = {
    SUCCESS: 0,
    FAILED: 0,
    DENIED: 0,
  };
  for (const e of eventsWithStatus) {
    statusCounts[e.status]++;
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
  });
}
