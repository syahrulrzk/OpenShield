/**
 * /api/events/apps — list app user access events (JSON)
 *
 * GET /api/events/apps?q=<text>&range=<1h|24h|7d>
 *
 * Returns events from t_event_log_user_access populated by the app ingest API.
 *
 * Filters:
 *   - q          : free-text search across message, actorEmail, actorUsername, eventType
 *   - range      : 1h | 24h | 7d
 *   - appId      : asset ID (exact)
 *   - eventType  : user.login | user.logout | user.login_failed | ... (exact)
 *   - severity   : ERROR | WARN | INFO | CRITICAL
 *   - actorEmail : actor email (contains)
 *   - actorIp    : actor IP (contains)
 *
 * Auth: session check (RBAC).
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
  const appId = sp.get("appId")?.trim() || "";
  const eventType = sp.get("eventType")?.trim() || "";
  const severity = sp.get("severity")?.trim() || "";
  const actorEmail = sp.get("actorEmail")?.trim() || "";
  const actorIp = sp.get("actorIp")?.trim() || "";

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

  // Base where — exact-match filters + window + asset filter
  const baseWhere: Prisma.TEventLogUserAccessWhereInput = {
    eventTime: { gte: since },
    asset: { userId: session.userId, category: "APP" },
    ...(appId ? { assetId: appId } : {}),
    ...(eventType ? { eventType } : {}),
    ...(severity ? { severity } : {}),
    ...(actorEmail ? { actorEmail: { contains: actorEmail, mode: "insensitive" } } : {}),
    ...(actorIp ? { actorIp: { contains: actorIp } } : {}),
  };

  // Search filters from `q` (date parse + tokens with field:value support)
  const andClauses: Prisma.TEventLogUserAccessWhereInput[] = [];
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
          case "app":
            andClauses.push({
              OR: [
                { asset: { displayName: { contains: v, mode: "insensitive" } } },
                { asset: { hostname: { contains: v, mode: "insensitive" } } },
              ],
            });
            break;
          case "type":
            andClauses.push({ eventType: { contains: v, mode: "insensitive" } });
            break;
          case "actor":
          case "email":
            andClauses.push({
              OR: [
                { actorEmail: { contains: v, mode: "insensitive" } },
                { actorUsername: { contains: v, mode: "insensitive" } },
              ],
            });
            break;
          case "ip":
            andClauses.push({ actorIp: { contains: v } });
            break;
          case "msg":
          case "message":
            andClauses.push({ message: { contains: v, mode: "insensitive" } });
            break;
          case "sev":
          case "severity":
            andClauses.push({ severity: { equals: v.toUpperCase() } });
            break;
          default:
            andClauses.push({
              OR: [
                { message: { contains: token, mode: "insensitive" } },
                { actorEmail: { contains: token, mode: "insensitive" } },
                { actorUsername: { contains: token, mode: "insensitive" } },
                { eventType: { contains: token, mode: "insensitive" } },
              ],
            });
        }
      } else {
        andClauses.push({
          OR: [
            { message: { contains: token, mode: "insensitive" } },
            { actorEmail: { contains: token, mode: "insensitive" } },
            { actorUsername: { contains: token, mode: "insensitive" } },
            { eventType: { contains: token, mode: "insensitive" } },
          ],
        });
      }
    }
  }

  const where: Prisma.TEventLogUserAccessWhereInput = {
    ...baseWhere,
    ...(andClauses.length > 0 ? { AND: andClauses } : {}),
  };

  const [rawEvents, total] = await Promise.all([
    prisma.tEventLogUserAccess.findMany({
      where,
      orderBy: { eventTime: "desc" },
      take: 500,
      select: {
        id: true,
        eventTime: true,
        severity: true,
        eventType: true,
        assetId: true,
        actorUserId: true,
        actorEmail: true,
        actorUsername: true,
        actorIp: true,
        actorUserAgent: true,
        targetType: true,
        targetId: true,
        targetName: true,
        requestId: true,
        sessionId: true,
        message: true,
        metadata: true,
        rawData: true,
        count: true,
        asset: {
          select: {
            id: true,
            hostname: true,
            displayName: true,
            appType: true,
          },
        },
      },
    }),
    prisma.tEventLogUserAccess.count({ where: baseWhere }),
  ]);

  // Shape rows for the UI. Flatten typed cols + keep rawData for details panel.
  const events = rawEvents.map((e) => ({
    id: e.id,
    eventTime: e.eventTime.toISOString(),
    timestamp: e.eventTime.toISOString().slice(0, 19).replace("T", " "),
    severity: e.severity,
    eventType: e.eventType,
    assetId: e.assetId,
    actorUserId: e.actorUserId,
    actorEmail: e.actorEmail,
    actorUsername: e.actorUsername,
    actorIp: e.actorIp,
    actorUserAgent: e.actorUserAgent,
    targetType: e.targetType,
    targetId: e.targetId,
    targetName: e.targetName,
    requestId: e.requestId,
    sessionId: e.sessionId,
    message: e.message,
    metadata: e.metadata,
    rawData: e.rawData,
    count: e.count,
    asset: e.asset,
  }));

  // Breakdown counters for the header chips + side cards.
  const eventTypeCounts: Record<string, number> = {};
  const severityCounts: Record<string, number> = {};
  const appCounts: Record<string, number> = {};
  const actorCounts: Record<string, number> = {};
  let loginFailCount = 0;
  let loginSuccessCount = 0;

  for (const e of events) {
    eventTypeCounts[e.eventType] = (eventTypeCounts[e.eventType] ?? 0) + 1;
    severityCounts[e.severity] = (severityCounts[e.severity] ?? 0) + 1;
    const appKey = e.asset?.displayName || e.asset?.hostname || e.assetId || "unknown";
    appCounts[appKey] = (appCounts[appKey] ?? 0) + 1;
    const actorKey = e.actorEmail || e.actorUsername || "unknown";
    actorCounts[actorKey] = (actorCounts[actorKey] ?? 0) + 1;
    if (e.eventType === "user.login_failed") loginFailCount++;
    if (e.eventType === "user.login") loginSuccessCount++;
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
    // Counts for chips + side cards
    eventTypeCounts,
    severityCounts,
    appCounts,
    actorCounts,
    // Side card summaries
    loginFailCount,
    loginSuccessCount,
    // Top-N lists for filter dropdowns / side cards
    topApps: topN(appCounts, 5),
    topActors: topN(actorCounts, 5),
    eventTypeOptions: topN(eventTypeCounts, 10),
    severityOptions: ["ERROR", "WARN", "INFO"]
      .map((s) => ({ value: s, label: s, count: severityCounts[s] ?? 0 }))
      .filter((s) => s.count > 0),
    // Applied filters echo
    filters: {
      appId: appId || undefined,
      eventType: eventType || undefined,
      severity: severity || undefined,
      actorEmail: actorEmail || undefined,
      actorIp: actorIp || undefined,
    },
  });
}
