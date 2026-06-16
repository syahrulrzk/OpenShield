import { prisma } from "@/lib/db";
import { getSession } from "@/lib/security/rbac";
import { startOfDay, subDays, subHours } from "date-fns";
import { DashboardClient } from "./_components/dashboard-client";

async function getStats(userId: string) {
  const now = new Date();
  const today = startOfDay(now);
  const last24h = subHours(now, 24);
  const last7d = subDays(now, 7);

  const [
    // Asset stats
    totalAssets,
    onlineAssets,
    assetsByStatus,
    assetsByDbType,
    // SSH stats
    sshSuccessToday,
    sshFailedToday,
    sshLast24h,
    // DB stats
    dbSuccessToday,
    dbFailedToday,
    dbLast24h,
    dbByType,
    // Alerts
    openAlerts,
    criticalAlerts,
    alertsBySeverity,
    // Top attackers (SSH)
    topSshAttackers,
    // Top attackers (DB)
    topDbAttackers,
    // Top countries
    topCountries,
    // Time series (24h, hourly buckets)
    sshTimeseries,
    dbTimeseries,
    // Recent activity
    recentSsh,
    recentDb,
  ] = await Promise.all([
    prisma.asset.count({ where: { userId } }),
    prisma.asset.count({ where: { userId, status: "ONLINE" } }),
    prisma.asset.groupBy({ by: ["status"], where: { userId }, _count: { status: true } }),
    prisma.asset.groupBy({ by: ["dbType"], where: { userId, NOT: { dbType: "NONE" } }, _count: { dbType: true } }),

    prisma.sshEvent.count({ where: { asset: { userId }, status: "SUCCESS", eventTime: { gte: today } } }),
    prisma.sshEvent.count({ where: { asset: { userId }, status: { in: ["FAILED", "INVALID"] }, eventTime: { gte: today } } }),
    prisma.sshEvent.count({ where: { asset: { userId }, eventTime: { gte: last24h } } }),

    prisma.dbEvent.count({ where: { asset: { userId }, status: "SUCCESS", eventTime: { gte: today } } }),
    prisma.dbEvent.count({ where: { asset: { userId }, status: { in: ["FAILED", "DENIED"] }, eventTime: { gte: today } } }),
    prisma.dbEvent.count({ where: { asset: { userId }, eventTime: { gte: last24h } } }),
    prisma.dbEvent.groupBy({ by: ["dbType"], where: { asset: { userId }, eventTime: { gte: last24h } }, _count: { dbType: true } }),

    prisma.alert.count({ where: { asset: { userId }, status: "OPEN" } }),
    prisma.alert.count({ where: { asset: { userId }, severity: "CRITICAL", status: "OPEN" } }),
    prisma.alert.groupBy({ by: ["severity"], where: { asset: { userId }, status: "OPEN" }, _count: { severity: true } }),

    prisma.$queryRaw<{ source_ip: string; failedCount: bigint }[]>`
      SELECT e.source_ip, COUNT(*) as "failedCount"
      FROM ssh_events e
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
      FROM ssh_events
      WHERE asset_id IN (SELECT id FROM assets WHERE user_id = ${userId})
        AND country IS NOT NULL
        AND event_time >= ${last7d}
      GROUP BY country
      ORDER BY count DESC
      LIMIT 10
    `,
    prisma.$queryRaw<{ hour: Date; success: bigint; failed: bigint }[]>`
      SELECT date_trunc('hour', event_time) as hour,
        COUNT(*) FILTER (WHERE status = 'SUCCESS') as success,
        COUNT(*) FILTER (WHERE status IN ('FAILED','INVALID')) as failed
      FROM ssh_events
      WHERE asset_id IN (SELECT id FROM assets WHERE user_id = ${userId})
        AND event_time >= ${last24h}
      GROUP BY hour
      ORDER BY hour ASC
    `,
    prisma.$queryRaw<{ hour: Date; success: bigint; failed: bigint }[]>`
      SELECT date_trunc('hour', event_time) as hour,
        COUNT(*) FILTER (WHERE status = 'SUCCESS') as success,
        COUNT(*) FILTER (WHERE status IN ('FAILED','DENIED')) as failed
      FROM db_events
      WHERE asset_id IN (SELECT id FROM assets WHERE user_id = ${userId})
        AND event_time >= ${last24h}
      GROUP BY hour
      ORDER BY hour ASC
    `,
    prisma.sshEvent.findMany({
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
    totalAssets,
    onlineAssets,
    assetsByStatus: Object.fromEntries(assetsByStatus.map((s) => [s.status, s._count.status])),
    assetsByDbType: Object.fromEntries(assetsByDbType.map((d) => [d.dbType, d._count.dbType])),
    // SSH
    sshSuccessToday,
    sshFailedToday,
    sshLast24h,
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
    sshTimeseries: sshTimeseries.map((r) => ({
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
    recentSsh: recentSsh.map((e) => ({
      id: e.id,
      hostname: e.asset.hostname,
      username: e.username,
      sourceIp: e.sourceIp,
      status: e.status,
      eventTime: e.eventTime.toISOString(),
    })),
    recentDb: recentDb.map((e) => ({
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
  if (!session) return null;

  const stats = await getStats(session.userId);

  return <DashboardClient stats={stats} />;
}
