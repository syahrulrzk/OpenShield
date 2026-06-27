import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { getSession } from "@/lib/security/rbac";
import {
  AlertCircle,
  AlertTriangle,
  Info,
  Box,
  Activity,
  Filter,
  User,
} from "lucide-react";
import { subHours, subDays } from "date-fns";
import Link from "next/link";
import { parseDateFromQuery } from "@/lib/search/query-parsers";
import {
  AppsEventsContent,
  type AppsEventsData,
} from "./_components/apps-events-content";

type Search = {
  range?: string;
  q?: string;
  appId?: string;
  eventType?: string;
  severity?: string;
  actorEmail?: string;
  actorIp?: string;
};

export default async function AppsEventsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) return null;

  const range = sp.range === "7d" ? "7d" : sp.range === "1h" ? "1h" : "24h";
  const q = sp.q?.trim() || "";
  const appId = sp.appId?.trim() || "";
  const eventType = sp.eventType?.trim() || "";
  const severity = sp.severity?.trim() || "";
  const actorEmail = sp.actorEmail?.trim() || "";
  const actorIp = sp.actorIp?.trim() || "";

  const since =
    range === "1h"
      ? subHours(new Date(), 1)
      : range === "7d"
        ? subDays(new Date(), 7)
        : subHours(new Date(), 24);

  // Base filter for initial SSR query
  const baseWhere: Prisma.TEventLogUserAccessWhereInput = {
    eventTime: { gte: since },
    asset: { userId: session.userId, category: "APP" },
    ...(appId ? { assetId: appId } : {}),
    ...(eventType ? { eventType } : {}),
    ...(severity ? { severity } : {}),
    ...(actorEmail ? { actorEmail: { contains: actorEmail, mode: "insensitive" } } : {}),
    ...(actorIp ? { actorIp: { contains: actorIp } } : {}),
  };

  // Build search filters
  const andClauses: Prisma.TEventLogUserAccessWhereInput[] = [];
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
          { message: { contains: textQuery, mode: "insensitive" } },
          { actorEmail: { contains: textQuery, mode: "insensitive" } },
          { actorUsername: { contains: textQuery, mode: "insensitive" } },
          { eventType: { contains: textQuery, mode: "insensitive" } },
        ],
      });
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
    prisma.tEventLogUserAccess.count({
      where: {
        ...baseWhere,
        ...(andClauses.length > 0 ? { AND: andClauses } : {}),
      },
    }),
  ]);

  const events = rawEvents.slice(0, 100).map((e) => ({
    id: e.id,
    eventTime: e.eventTime.toISOString(),
    timestamp: e.eventTime.toISOString().slice(0, 19).replace("T", " "),
    severity: e.severity as "INFO" | "WARN" | "ERROR" | "CRITICAL",
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

  // Counters
  const eventTypeCounts: Record<string, number> = {};
  const severityCounts: Record<string, number> = {};
  const appCounts: Record<string, number> = {};
  const actorCounts: Record<string, number> = {};
  let loginFailCount = 0;
  let loginSuccessCount = 0;

  for (const e of rawEvents) {
    eventTypeCounts[e.eventType] = (eventTypeCounts[e.eventType] ?? 0) + 1;
    severityCounts[e.severity] = (severityCounts[e.severity] ?? 0) + 1;
    const appKey = e.asset?.displayName || e.asset?.hostname || e.assetId;
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

  const eventsForInitial = events as unknown as AppsEventsData["events"];
  const initialData: AppsEventsData = {
    events: eventsForInitial,
    total,
    displayed: eventsForInitial.length,
    range,
    q,
    eventTypeCounts,
    severityCounts,
    appCounts,
    actorCounts,
    loginFailCount,
    loginSuccessCount,
    topApps: topN(appCounts, 5),
    topActors: topN(actorCounts, 5),
    eventTypeOptions: topN(eventTypeCounts, 10),
    severityOptions: ["ERROR", "WARN", "INFO"]
      .map((s) => ({ value: s, label: s, count: severityCounts[s] ?? 0 }))
      .filter((s) => s.count > 0),
    filters: {
      appId: appId || undefined,
      eventType: eventType || undefined,
      severity: severity || undefined,
      actorEmail: actorEmail || undefined,
      actorIp: actorIp || undefined,
    },
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            App Events
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            User access events from integrated apps via API ingest.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <Link
            href="/dashboard/apps"
            className="text-[var(--muted-foreground)] hover:text-[var(--accent)] transition-colors"
          >
            ← Apps
          </Link>
        </div>
      </div>

      {/* Active filter banner */}
      {(appId || eventType || severity || actorEmail || actorIp || q) && (
        <div className="flex items-center justify-between p-3 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5">
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <Filter className="h-3.5 w-3.5" />
            <span>
              Filter aktif:{" "}
              <span className="text-zinc-100 font-mono">
                {appId && `app:${appId}`}
                {eventType && ` type:${eventType}`}
                {severity && ` sev:${severity}`}
                {actorEmail && ` actor:${actorEmail}`}
                {actorIp && ` ip:${actorIp}`}
                {q && ` q:"${q}"`}
              </span>
            </span>
          </div>
          <Link
            href="/dashboard/events/apps"
            className="text-xs text-[var(--muted-foreground)] hover:text-[var(--accent)] transition-colors"
          >
            ✕ Clear filter
          </Link>
        </div>
      )}

      <AppsEventsContent initialData={initialData} />
    </div>
  );
}
