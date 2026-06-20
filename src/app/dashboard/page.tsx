import { prisma } from "@/lib/db";
import { getSession } from "@/lib/security/rbac";
import { startOfDay, subDays, subHours } from "date-fns";
import { DashboardClient } from "./_components/dashboard-client";
import { redirect } from "next/navigation";


/**
 * Count "server" (SSH-like) events from agent_events table.
 * This is the fallback when server_events table is empty
 * (i.e., before poller has been run for any asset).
 *
 * Filters: source LIKE '%auth.log%' or raw_data has 'ip' field
 * SUCCESS: severity = INFO + message contains "login OK"
 * FAILED: severity = ERROR + message contains "login failed"
 */
async function getAgentServerStats(userId: string, today: Date, last24h: Date, last7d: Date) {
  // Agents don't have userId filter (global agents table)
  const sshEvents = await prisma.agentEvent.findMany({
    where: {
      source: { contains: 'auth.log' },
      eventTime: { gte: last24h },
    },
    select: {
      severity: true,
      message: true,
      rawData: true,
      eventTime: true,
    },
  });

  let successToday = 0;
  let failedToday = 0;
  let success24h = 0;
  let failed24h = 0;
  const ipCounts: Record<string, number> = {};
  const countryCounts: Record<string, number> = {};
  const hourlyBuckets: Record<string, { success: number; failed: number }> = {};

  for (const e of sshEvents) {
    const isSuccess = e.message.includes('login OK') || e.severity === 'INFO' && e.message.includes('Accepted');
    const isFailed = e.message.includes('login failed') || e.severity === 'ERROR';
    const hour = new Date(e.eventTime).toISOString().slice(0, 13) + ':00:00Z';

    if (!hourlyBuckets[hour]) hourlyBuckets[hour] = { success: 0, failed: 0 };

    if (isSuccess) {
      hourlyBuckets[hour].success++;
      success24h++;
      if (e.eventTime >= today) successToday++;
    } else if (isFailed) {
      hourlyBuckets[hour].failed++;
      failed24h++;
      if (e.eventTime >= today) failedToday++;

      // Extract IP from raw_data
      const rd = e.rawData as any;
      if (rd?.ip) {
        ipCounts[rd.ip] = (ipCounts[rd.ip] || 0) + 1;
      }
    }
  }

  const topAttackers = Object.entries(ipCounts)
    .map(([source_ip, failedCount]) => ({ source_ip, failedCount: BigInt(failedCount) }))
    .sort((a, b) => Number(b.failedCount - a.failedCount))
    .slice(0, 10);

  return {
    successToday,
    failedToday,
    success24h,
    failed24h,
    topAttackers,
    timeseries: Object.entries(hourlyBuckets)
      .map(([hour, v]) => ({ hour: new Date(hour), success: BigInt(v.success), failed: BigInt(v.failed) }))
      .sort((a, b) => a.hour.getTime() - b.hour.getTime()),
  };
}

async function getStats(userId: string) {
  const now = new Date();
  const today = startOfDay(now);
  const last24h = subHours(now, 24);
  const last7d = subDays(now, 7);

  // ─── Phase 1: source-of-truth + agentEvent fallback (compute once) ─────
  // The old `serverEvent`/`dbEvent`/`asset` tables are scoped per user and only
  // populated by the legacy poller. New agents write directly to `agentEvent`,
  // which is global. So we probe each legacy table once; if empty, fall back
  // to `agentEvent` (already implements all the parsing we need).
  const [serverEventCount24h, dbEventCount24h] = await Promise.all([
    prisma.serverEvent.count({ where: { eventTime: { gte: last24h } } }),
    prisma.dbEvent.count({ where: { eventTime: { gte: last24h } } }),
  ]);
  const useAgentFallback = serverEventCount24h === 0;
  const useDbFallback = dbEventCount24h === 0;

  // Single agentEvents scan — reuse for stats + timeseries + recent activity.
  const agentStats = useAgentFallback
    ? await getAgentServerStats(userId, today, last24h, last7d)
    : null;

  const [
    // Asset stats
    totalAgents,
    onlineAgents,
    assetsByStatusRaw,
    assetsByDbType,
    assetsByEnvironment,
    // SSH stats
    serverSuccessToday,
    serverFailedToday,
    serverLast24h,
    // DB stats
    dbSuccessToday,
    dbFailedToday,
    dbLast24h,
    dbByType,
    // Alerts
    openAlerts,
    criticalAlerts,
    alertsBySeverity,
    // Top attackers (SSH) — fallback path uses precomputed agentStats
    topSshAttackers,
    // Top attackers (DB)
    topDbAttackers,
    // Top countries
    topCountries,
    // Time series (24h, hourly buckets) — fallback uses precomputed
    serverTimeseries,
    dbTimeseries,
    // Recent activity — fallback pulls from agentEvent directly
    recentSsh,
    recentDb,
  ] = await Promise.all([
    prisma.agent.count(),
    prisma.agent.count({ where: { status: "ONLINE" } }),
    // Group agents by status for Asset Status pie (real, not stubbed)
    prisma.agent.groupBy({ by: ["status"], _count: { status: true } }),
    Promise.resolve<any[]>([]),  // assetsByDbType removed
    Promise.resolve<any[]>([]),  // assetsByEnvironment removed

    // Server stats: use server_events if available, fallback to agent_events
    useAgentFallback
      ? Promise.resolve(agentStats!.successToday)
      : prisma.serverEvent.count({ where: { asset: { userId }, status: "SUCCESS", eventTime: { gte: today } } }),
    useAgentFallback
      ? Promise.resolve(agentStats!.failedToday)
      : prisma.serverEvent.count({ where: { asset: { userId }, status: { in: ["FAILED", "INVALID"] }, eventTime: { gte: today } } }),
    useAgentFallback
      ? Promise.resolve(agentStats!.success24h + agentStats!.failed24h)
      : prisma.serverEvent.count({ where: { asset: { userId }, eventTime: { gte: last24h } } }),

    prisma.dbEvent.count({ where: { asset: { userId }, status: "SUCCESS", eventTime: { gte: today } } }),
    prisma.dbEvent.count({ where: { asset: { userId }, status: { in: ["FAILED", "DENIED"] }, eventTime: { gte: today } } }),
    prisma.dbEvent.count({ where: { asset: { userId }, eventTime: { gte: last24h } } }),
    prisma.dbEvent.groupBy({ by: ["dbType"], where: { asset: { userId }, eventTime: { gte: last24h } }, _count: { dbType: true } }),

    prisma.alert.count({ where: { status: "OPEN" } }),
    prisma.alert.count({ where: { severity: "CRITICAL", status: "OPEN" } }),
    prisma.alert.groupBy({ by: ["severity"], where: { status: "OPEN" }, _count: { severity: true } }),

    useAgentFallback
      ? Promise.resolve(agentStats!.topAttackers)
      : prisma.$queryRaw<{ source_ip: string; failedCount: bigint }[]>`
        SELECT e.source_ip, COUNT(*) as "failedCount"
        FROM server_events e
        JOIN assets a ON e.asset_id = a.id
        WHERE a.user_id = ${userId} AND e.status IN ('FAILED','INVALID') AND e.event_time >= ${last7d}
        GROUP BY e.source_ip
        ORDER BY "failedCount" DESC
        LIMIT 10
      `,
    prisma.$queryRaw<{ source_ip: string; failedCount: bigint; dbType: string }[]>`
      SELECT e.source_ip, e.db_type, COUNT(*) as "failedCount"
      FROM db_events e
      JOIN assets a ON e.asset_id = a.id
      WHERE a.user_id = ${userId} AND e.status IN ('FAILED','DENIED') AND e.event_time >= ${last7d}
      GROUP BY e.source_ip, e.db_type
      ORDER BY "failedCount" DESC
      LIMIT 10
    `,
    prisma.$queryRaw<{ country: string; count: bigint }[]>`
      SELECT country, COUNT(*) as count
      FROM server_events
      WHERE asset_id IN (SELECT id FROM assets WHERE user_id = ${userId})
        AND country IS NOT NULL
        AND event_time >= ${last7d}
      GROUP BY country
      ORDER BY count DESC
      LIMIT 10
    `,
    useAgentFallback
      ? Promise.resolve(agentStats!.timeseries)
      : prisma.$queryRaw<{ hour: Date; success: bigint; failed: bigint }[]>`
        SELECT date_trunc('hour', event_time) as hour,
          COUNT(*) FILTER (WHERE status = 'SUCCESS') as success,
          COUNT(*) FILTER (WHERE status IN ('FAILED','INVALID')) as failed
        FROM server_events
        WHERE asset_id IN (SELECT id FROM assets WHERE user_id = ${userId})
          AND event_time >= ${last24h}
        GROUP BY hour
        ORDER BY hour ASC
      `,
    useDbFallback
      ? Promise.resolve([] as { hour: Date; success: bigint; failed: bigint }[])
      : prisma.$queryRaw<{ hour: Date; success: bigint; failed: bigint }[]>`
        SELECT date_trunc('hour', event_time) as hour,
          COUNT(*) FILTER (WHERE status = 'SUCCESS') as success,
          COUNT(*) FILTER (WHERE status IN ('FAILED','DENIED')) as failed
        FROM db_events
        WHERE asset_id IN (SELECT id FROM assets WHERE user_id = ${userId})
          AND event_time >= ${last24h}
        GROUP BY hour
        ORDER BY hour ASC
      `,
    useAgentFallback
      ? prisma.agentEvent.findMany({
          where: { source: { contains: "auth.log" } },
          orderBy: { eventTime: "desc" },
          take: 8,
          include: { agent: { select: { name: true, hostname: true } } },
        })
      : prisma.serverEvent.findMany({
          where: { asset: { userId } },
          orderBy: { eventTime: "desc" },
          take: 8,
          include: { asset: { select: { hostname: true } } },
        }),
    prisma.dbEvent.findMany({
      where: { asset: { userId } },
      orderBy: { eventTime: "desc" },
      take: 8,
      include: { asset: { select: { hostname: true } } },
    }),
  ]);

  return {
    // Asset summary
    totalAgents,
    onlineAgents,
    assetsByStatus: Object.fromEntries((assetsByStatusRaw as any[]).map((s: any) => [s.status, s._count.status])),
    assetsByDbType: Object.fromEntries((assetsByDbType as any[]).map((d: any) => [d.dbType, d._count.dbType])),
    assetsByEnvironment: Object.fromEntries((assetsByEnvironment as any[]).map((e: any) => [e.environment, e._count.environment])),
    // SSH
    serverSuccessToday,
    serverFailedToday,
    serverLast24h,
    // DB
    dbSuccessToday,
    dbFailedToday,
    dbLast24h,
    dbByType: Object.fromEntries(dbByType.map((d) => [d.dbType, d._count.dbType])),
    // Alerts
    openAlerts,
    criticalAlerts,
    alertsBySeverity: Object.fromEntries(alertsBySeverity.map((a) => [a.severity, a._count.severity])),
    // Top
    topSshAttackers: topSshAttackers.map((r) => ({ ip: r.source_ip, count: Number(r.failedCount) })),
    topDbAttackers: topDbAttackers.map((r) => ({ ip: r.source_ip, dbType: r.dbType, count: Number(r.failedCount) })),
    topCountries: topCountries.map((r) => ({ country: r.country, count: Number(r.count) })),
    // Time series
    serverTimeseries: serverTimeseries.map((r) => ({
      hour: r.hour.toISOString(),
      success: Number(r.success),
      failed: Number(r.failed),
    })),
    dbTimeseries: dbTimeseries.map((r) => ({
      hour: r.hour.toISOString(),
      success: Number(r.success),
      failed: Number(r.failed),
    })),
    // Recent
    // Handle both shapes:
    //   • legacy serverEvent: { asset: { hostname }, username, sourceIp, status, eventTime }
    //   • new agentEvent:     { agent: { name, hostname }, severity, message, rawData, eventTime }
    recentSsh: recentSsh.map((e: any) => {
      // legacy serverEvent shape
      if (e.asset) {
        return {
          id: e.id,
          hostname: e.asset.hostname,
          username: e.username,
          sourceIp: e.sourceIp,
          status: e.status,
          eventTime: e.eventTime.toISOString(),
        };
      }
      // agentEvent shape — derive fields from rawData + message
      const rd = (e.rawData ?? {}) as Record<string, unknown>;
      const msg = String(e.message ?? "");
      const username =
        (typeof rd.user === "string" && rd.user) ||
        (typeof rd.username === "string" && rd.username) ||
        (msg.match(/\b(?:for|user)\s+(?:invalid\s+user\s+)?([a-zA-Z0-9._\-\[\]]+)/i)?.[1] ?? null);
      const sourceIp =
        (typeof rd.ip === "string" && rd.ip) ||
        (msg.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0] ?? null);
      let status: string;
      if (e.severity === "ERROR" || /login\s+failed|invalid\s+user/i.test(msg)) {
        status = /invalid\s+user/i.test(msg) ? "INVALID" : "FAILED";
      } else if (e.severity === "INFO" && /login\s+OK|Accepted/i.test(msg)) {
        status = "SUCCESS";
      } else {
        status = e.severity ?? "INFO";
      }
      return {
        id: e.id,
        hostname: e.agent?.hostname || e.agent?.name || "—",
        username,
        sourceIp,
        status,
        eventTime: e.eventTime.toISOString(),
      };
    }),
    recentDb: recentDb.map((e: any) => ({
      id: e.id,
      hostname: e.asset.hostname,
      dbType: e.dbType as string,
      username: e.username,
      sourceIp: e.sourceIp,
      status: e.status,
      eventTime: e.eventTime.toISOString(),
    })),
  };
}

export default async function DashboardHome() {
  const session = await getSession();
  if (!session) redirect("/login");

  const stats = await getStats(session.userId);

  return <DashboardClient stats={stats} />;
}
