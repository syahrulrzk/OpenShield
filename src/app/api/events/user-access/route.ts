/**
 * /api/events/user-access — list user access audit events (JSON)
 *
 * GET /api/events/user-access?q=<text>&range=<1h|24h|7d>&eventType=...&severity=...&appId=...&actorEmail=...&actorIp=...
 *
 * Returns events from t_event_log_user_access populated by the public
 * webhook endpoint POST /api/ingest/apps (X-API-Key auth).
 *
 * Filters:
 *   - q          : free-text search across message, actorEmail, actorUsername,
 *                  actorIp, targetName, eventType, metadata (tokens)
 *   - range      : 1h | 24h | 7d | 30d
 *   - eventType  : user.login | user.logout | user.role_changed | ...
 *   - severity   : INFO | WARN | ERROR | CRITICAL
 *   - appId      : filter by app asset ID
 *   - actorEmail : exact email match
 *   - actorIp    : exact IP match
 *   - actorUserId: exact user ID match
 *   - targetId   : exact target ID match
 *
 * Auth: session check (RBAC) — same as network/server route.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/security/rbac";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { subHours, subDays } from "date-fns";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const range = sp.get("range") || "24h";
  const q = sp.get("q")?.trim() || "";
  const eventType = sp.get("eventType")?.trim() || "";
  const severity = sp.get("severity")?.trim() || "";
  const appId = sp.get("appId")?.trim() || "";
  const actorEmail = sp.get("actorEmail")?.trim() || "";
  const actorIp = sp.get("actorIp")?.trim() || "";
  const actorUserId = sp.get("actorUserId")?.trim() || "";
  const targetId = sp.get("targetId")?.trim() || "";
  const limitParam = Math.min(Math.max(parseInt(sp.get("limit") || "200", 10) || 200, 1), 1000);

  const since =
    range === "1h"
      ? subHours(new Date(), 1)
      : range === "7d"
        ? subDays(new Date(), 7)
        : range === "30d"
          ? subDays(new Date(), 30)
          : subDays(new Date(), 1);

  const baseWhere: Prisma.TEventLogUserAccessWhereInput = {
    eventTime: { gte: since },
    ...(eventType ? { eventType } : {}),
    ...(severity ? { severity } : {}),
    ...(appId ? { assetId: appId } : {}),
    ...(actorEmail ? { actorEmail } : {}),
    ...(actorIp ? { actorIp } : {}),
    ...(actorUserId ? { actorUserId } : {}),
    ...(targetId ? { targetId } : {}),
  };

  // Free-text search — match against multiple fields
  const andClauses: Prisma.TEventLogUserAccessWhereInput[] = [];
  if (q && q.length >= 2) {
    const tokens = q
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);
    if (tokens.length > 0) {
      const orClauses: Prisma.TEventLogUserAccessWhereInput[] = [];
      for (const tok of tokens) {
        // Try field:value pattern
        if (tok.includes(":")) {
          const [field, ...rest] = tok.split(":");
          const val = rest.join(":").trim();
          if (!val) continue;
          switch (field.toLowerCase()) {
            case "app":
            case "appid":
              orClauses.push({ assetId: val });
              break;
            case "email":
            case "actor":
              orClauses.push({ actorEmail: { contains: val, mode: "insensitive" } });
              break;
            case "user":
            case "userid":
              orClauses.push({ actorUserId: val });
              break;
            case "ip":
              orClauses.push({ actorIp: val });
              break;
            case "type":
            case "event":
              orClauses.push({ eventType: { contains: val, mode: "insensitive" } });
              break;
            case "target":
              orClauses.push({ targetId: val });
              break;
            default:
              // Unknown field — fall through to generic message search
              orClauses.push({ message: { contains: tok, mode: "insensitive" } });
          }
        } else {
          // Plain token — search across multiple fields
          orClauses.push({
            OR: [
              { message: { contains: tok, mode: "insensitive" } },
              { actorEmail: { contains: tok, mode: "insensitive" } },
              { actorUsername: { contains: tok, mode: "insensitive" } },
              { actorIp: tok },
              { targetName: { contains: tok, mode: "insensitive" } },
              { eventType: { contains: tok, mode: "insensitive" } },
            ],
          });
        }
      }
      if (orClauses.length > 0) {
        andClauses.push({ OR: orClauses });
      }
    }
  }

  const where: Prisma.TEventLogUserAccessWhereInput =
    andClauses.length > 0 ? { AND: [baseWhere, ...andClauses] } : baseWhere;

  // Fetch events + counts in parallel
  const [events, total, eventTypeCounts, severityCounts, appCounts, topActors] =
    await Promise.all([
      prisma.tEventLogUserAccess.findMany({
        where,
        orderBy: { eventTime: "desc" },
        take: limitParam,
        include: {
          asset: { select: { id: true, displayName: true, appType: true, ownerTeam: true } },
        },
      }),
      prisma.tEventLogUserAccess.count({ where }),
      prisma.tEventLogUserAccess.groupBy({
        by: ["eventType"],
        where: baseWhere,
        _count: { _all: true },
      }),
      prisma.tEventLogUserAccess.groupBy({
        by: ["severity"],
        where: baseWhere,
        _count: { _all: true },
      }),
      prisma.tEventLogUserAccess.groupBy({
        by: ["assetId"],
        where: baseWhere,
        _count: { _all: true },
      }),
      prisma.tEventLogUserAccess.groupBy({
        by: ["actorEmail"],
        where: { ...baseWhere, actorEmail: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { actorEmail: "desc" } },
        take: 10,
      }),
    ]);

  // Resolve appId → displayName
  const appIds = appCounts.map((a) => a.assetId);
  const apps = await prisma.asset.findMany({
    where: { id: { in: appIds } },
    select: { id: true, displayName: true, appType: true, ownerTeam: true },
  });
  const appMap = new Map(apps.map((a) => [a.id, a]));

  // Security signal counts (per event type that indicates auth/perm activity)
  const eventTypeMap = new Map(eventTypeCounts.map((e) => [e.eventType, e._count._all]));
  const authEvents = ["user.login", "user.logout", "user.login_failed"];
  const permEvents = [
    "user.role_changed",
    "user.permission_granted",
    "user.permission_revoked",
  ];
  const sessionEvents = ["session.created", "session.expired"];
  const securityEvents = ["user.login_failed"];
  const authCount = authEvents.reduce((s, k) => s + (eventTypeMap.get(k) ?? 0), 0);
  const permCount = permEvents.reduce((s, k) => s + (eventTypeMap.get(k) ?? 0), 0);
  const sessionCount = sessionEvents.reduce((s, k) => s + (eventTypeMap.get(k) ?? 0), 0);
  const securityCount = securityEvents.reduce(
    (s, k) => s + (eventTypeMap.get(k) ?? 0),
    0
  );

  return NextResponse.json({
    events: events.map((e) => ({
      id: e.id,
      assetId: e.assetId,
      appName: e.asset?.displayName ?? null,
      appType: e.asset?.appType ?? null,
      ownerTeam: e.asset?.ownerTeam ?? null,
      eventType: e.eventType,
      severity: e.severity,
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
      eventTime: e.eventTime.toISOString(),
      count: e.count,
    })),
    total,
    counts: {
      eventType: eventTypeCounts.map((e) => ({
        eventType: e.eventType,
        count: e._count._all,
      })),
      severity: severityCounts.map((s) => ({
        severity: s.severity,
        count: s._count._all,
      })),
      app: appCounts.map((a) => {
        const app = appMap.get(a.assetId);
        return {
          appId: a.assetId,
          appName: app?.displayName ?? "(deleted)",
          appType: app?.appType ?? null,
          ownerTeam: app?.ownerTeam ?? null,
          count: a._count._all,
        };
      }),
      topActors: topActors.map((a) => ({
        actorEmail: a.actorEmail,
        count: a._count._all,
      })),
      authCount,
      permCount,
      sessionCount,
      securityCount,
    },
  });
}
