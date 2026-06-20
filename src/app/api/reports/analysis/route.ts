/**
 * /api/reports/analysis — Aggregated analytics
 *
 * GET /api/reports/analysis?days=7
 *
 * Returns JSON with trends, top attackers, top assets, top users,
 * top SUCCESSFUL users (with target servers), hourly heatmap
 */

import { prisma } from "@/lib/db";
import { requireRole, PERMISSIONS } from "@/lib/security/rbac";
import { subDays } from "date-fns";

export async function GET(req: Request) {
  const auth = await requireRole(...PERMISSIONS.ASSET_READ);
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const days = Math.min(parseInt(url.searchParams.get("days") ?? "7"), 90);
  const since = subDays(new Date(), days);

  const [
    sshByDay,
    dbByDay,
    topSshAttackers,
    topDbAttackers,
    topUsernames,
    topTargetAssets,
    topSuccessUserAssetPairs,
    statusBreakdown,
    dbTypeBreakdown,
    hourlyHeatmap,
    totals,
  ] = await Promise.all([
    // SSH events by day
    prisma.$queryRaw<{ day: Date; success: bigint; failed: bigint }[]>`
      SELECT date_trunc('day', event_time) as day,
        COUNT(*) FILTER (WHERE status = 'SUCCESS') as success,
        COUNT(*) FILTER (WHERE status IN ('FAILED','INVALID')) as failed
      FROM server_events
      WHERE asset_id IN (SELECT id FROM assets WHERE user_id = ${auth.userId})
        AND event_time >= ${since}
      GROUP BY day
      ORDER BY day ASC
    `,
    // DB events by day
    prisma.$queryRaw<{ day: Date; success: bigint; failed: bigint }[]>`
      SELECT date_trunc('day', event_time) as day,
        COUNT(*) FILTER (WHERE status = 'SUCCESS') as success,
        COUNT(*) FILTER (WHERE status IN ('FAILED','DENIED')) as failed
      FROM db_events
      WHERE asset_id IN (SELECT id FROM assets WHERE user_id = ${auth.userId})
        AND event_time >= ${since}
      GROUP BY day
      ORDER BY day ASC
    `,
    // Top SSH attacker IPs
    prisma.$queryRaw<{ source_ip: string; count: bigint }[]>`
      SELECT source_ip, COUNT(*) as count
      FROM server_events
      WHERE asset_id IN (SELECT id FROM assets WHERE user_id = ${auth.userId})
        AND status IN ('FAILED','INVALID') AND event_time >= ${since}
      GROUP BY source_ip
      ORDER BY count DESC
      LIMIT 20
    `,
    // Top DB attacker IPs
    prisma.$queryRaw<{ source_ip: string; count: bigint }[]>`
      SELECT source_ip, COUNT(*) as count
      FROM db_events
      WHERE asset_id IN (SELECT id FROM assets WHERE user_id = ${auth.userId})
        AND status IN ('FAILED','DENIED') AND event_time >= ${since} AND source_ip IS NOT NULL
      GROUP BY source_ip
      ORDER BY count DESC
      LIMIT 20
    `,
    // Top target usernames (most-attempted)
    prisma.$queryRaw<{ username: string; ssh: bigint; db: bigint }[]>`
      SELECT u.username, COALESCE(s.cnt, 0) as ssh, COALESCE(d.cnt, 0) as db
      FROM (
        SELECT username, COUNT(*) as cnt FROM server_events
        WHERE asset_id IN (SELECT id FROM assets WHERE user_id = ${auth.userId})
          AND event_time >= ${since}
        GROUP BY username
        UNION ALL
        SELECT username, COUNT(*) as cnt FROM db_events
        WHERE asset_id IN (SELECT id FROM assets WHERE user_id = ${auth.userId})
          AND event_time >= ${since}
        GROUP BY username
      ) u
      LEFT JOIN (
        SELECT username, COUNT(*) as cnt FROM server_events
        WHERE asset_id IN (SELECT id FROM assets WHERE user_id = ${auth.userId})
          AND event_time >= ${since}
        GROUP BY username
      ) s ON s.username = u.username
      LEFT JOIN (
        SELECT username, COUNT(*) as cnt FROM db_events
        WHERE asset_id IN (SELECT id FROM assets WHERE user_id = ${auth.userId})
          AND event_time >= ${since}
        GROUP BY username
      ) d ON d.username = u.username
      ORDER BY (COALESCE(s.cnt, 0) + COALESCE(d.cnt, 0)) DESC
      LIMIT 20
    `,
    // Top targeted assets (count all events, mark SSH/Db failed correctly)
    prisma.$queryRaw<{ hostname: string; events: bigint; failed: bigint }[]>`
      SELECT
        a.hostname,
        (
          (SELECT COUNT(*) FROM server_events WHERE asset_id = a.id AND event_time >= ${since})
          +
          (SELECT COUNT(*) FROM db_events WHERE asset_id = a.id AND event_time >= ${since})
        ) as events,
        (
          (SELECT COUNT(*) FROM server_events WHERE asset_id = a.id AND event_time >= ${since} AND status IN ('FAILED','INVALID'))
          +
          (SELECT COUNT(*) FROM db_events WHERE asset_id = a.id AND event_time >= ${since} AND status IN ('FAILED','DENIED'))
        ) as failed
      FROM assets a
      WHERE a.user_id = ${auth.userId}
      ORDER BY events DESC
      LIMIT 10
    `,
    // 🆕 Top SUCCESSFUL users with target servers (SSH only, success only)
    prisma.$queryRaw<{
      username: string;
      hostname: string;
      count: bigint;
      last_seen: Date;
    }[]>`
      SELECT e.username, a.hostname, COUNT(*) as count, MAX(e.event_time) as last_seen
      FROM server_events e
      INNER JOIN assets a ON a.id = e.asset_id
      WHERE a.user_id = ${auth.userId}
        AND e.status = 'SUCCESS'
        AND e.event_time >= ${since}
        AND e.username IS NOT NULL
      GROUP BY e.username, a.hostname
      ORDER BY count DESC
      LIMIT 100
    `,
    // SSH success vs fail
    prisma.serverEvent.groupBy({
      by: ["status"],
      where: { asset: { userId: auth.userId }, eventTime: { gte: since } },
      _count: { status: true },
    }),
    // DB by type
    prisma.dbEvent.groupBy({
      by: ["dbType", "status"],
      where: { asset: { userId: auth.userId }, eventTime: { gte: since } },
      _count: { id: true },
    }),
    // Hourly heatmap (day-of-week × hour)
    prisma.$queryRaw<{ dow: number; hour: number; count: bigint }[]>`
      SELECT EXTRACT(DOW FROM event_time)::int as dow, EXTRACT(HOUR FROM event_time)::int as hour, COUNT(*) as count
      FROM server_events
      WHERE asset_id IN (SELECT id FROM assets WHERE user_id = ${auth.userId})
        AND event_time >= ${since}
      GROUP BY dow, hour
    `,
    // Totals
    prisma.$queryRaw<{ ssh: bigint; db: bigint; failed: bigint }[]>`
      SELECT
        (SELECT COUNT(*) FROM server_events WHERE asset_id IN (SELECT id FROM assets WHERE user_id = ${auth.userId}) AND event_time >= ${since}) as ssh,
        (SELECT COUNT(*) FROM db_events WHERE asset_id IN (SELECT id FROM assets WHERE user_id = ${auth.userId}) AND event_time >= ${since}) as db,
        (SELECT COUNT(*) FROM server_events WHERE asset_id IN (SELECT id FROM assets WHERE user_id = ${auth.userId}) AND event_time >= ${since} AND status IN ('FAILED','INVALID'))
        + (SELECT COUNT(*) FROM db_events WHERE asset_id IN (SELECT id FROM assets WHERE user_id = ${auth.userId}) AND event_time >= ${since} AND status IN ('FAILED','DENIED')) as failed
    `,
  ]);

  // Build day series
  const sshDayMap = new Map(sshByDay.map((r) => [r.day.toISOString().slice(0, 10), r]));
  const dbDayMap = new Map(dbByDay.map((r) => [r.day.toISOString().slice(0, 10), r]));
  const allDays = new Set([...sshDayMap.keys(), ...dbDayMap.keys()]);
  const daySeries = Array.from(allDays)
    .sort()
    .map((d) => ({
      day: d,
      sshSuccess: Number(sshDayMap.get(d)?.success ?? 0),
      sshFailed: Number(sshDayMap.get(d)?.failed ?? 0),
      dbSuccess: Number(dbDayMap.get(d)?.success ?? 0),
      dbFailed: Number(dbDayMap.get(d)?.failed ?? 0),
    }));

  // Build top successful users (group by username, list their servers)
  const userMap = new Map<
    string,
    { username: string; assets: Map<string, { hostname: string; count: number; lastSeen: string }>; total: number }
  >();
  for (const row of topSuccessUserAssetPairs) {
    if (!userMap.has(row.username)) {
      userMap.set(row.username, {
        username: row.username,
        assets: new Map(),
        total: 0,
      });
    }
    const u = userMap.get(row.username)!;
    u.assets.set(row.hostname, {
      hostname: row.hostname,
      count: Number(row.count),
      lastSeen: row.last_seen.toISOString(),
    });
    u.total += Number(row.count);
  }
  const topSuccessUsers = Array.from(userMap.values())
    .map((u) => ({
      username: u.username,
      total: u.total,
      assets: Array.from(u.assets.values()).sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);

  return Response.json({
    period: { days, since: since.toISOString() },
    totals: {
      ssh: Number(totals[0]?.ssh ?? 0),
      db: Number(totals[0]?.db ?? 0),
      failed: Number(totals[0]?.failed ?? 0),
    },
    daySeries,
    topSshAttackers: topSshAttackers.map((r) => ({ ip: r.source_ip, count: Number(r.count) })),
    topDbAttackers: topDbAttackers.map((r) => ({ ip: r.source_ip, count: Number(r.count) })),
    topUsernames: topUsernames.map((r) => ({
      username: r.username,
      ssh: Number(r.ssh),
      db: Number(r.db),
      total: Number(r.ssh) + Number(r.db),
    })),
    topAssets: topTargetAssets.map((r) => ({
      hostname: r.hostname,
      events: Number(r.events),
      failed: Number(r.failed),
    })),
    topSuccessUsers,
    statusBreakdown: Object.fromEntries(statusBreakdown.map((s) => [s.status, s._count.status])),
    dbTypeBreakdown: dbTypeBreakdown.map((d) => ({ dbType: d.dbType, status: d.status, count: d._count.id })),
    hourlyHeatmap: hourlyHeatmap.map((h) => ({ dow: h.dow, hour: h.hour, count: Number(h.count) })),
  });
}
