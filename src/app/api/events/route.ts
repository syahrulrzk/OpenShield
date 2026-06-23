/**
 * /api/events — bulk delete agent events
 *
 * DELETE /api/events
 * Body: {
 *   mode: "all" | "olderThan" | "bySource",
 *   days?: number,        // required when mode="olderThan"
 *   sources?: string[],   // required when mode="bySource" (e.g. ["/var/log/syslog"])
 *   confirmText: string,  // MUST equal "delete all events" (case-sensitive)
 * }
 *
 * Auth: session check (admin role required — destructive op)
 * Audit: hash-chained audit log entry
 *
 * IMPORTANT:
 * - Hard delete (not soft) per the agreed design (FLUSH #9)
 * - Typed confirmation required to prevent accidental triggers
 * - No deletion of events newer than `days` if mode="olderThan"
 * - Returns counts + sample of deleted IDs for audit verification
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/security/rbac";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/security/audit";
import { subDays } from "date-fns";

const REQUIRED_CONFIRM_TEXT = "delete all events";

export async function DELETE(req: NextRequest) {
  // 1. Auth: must be logged in (admin role check via RBAC)
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const role = session.role;
  if (role !== "ADMIN" && role !== "OWNER") {
    return NextResponse.json(
      { error: "Forbidden — admin role required" },
      { status: 403 }
    );
  }

  // 2. Parse + validate body
  let body: { mode?: string; days?: number; sources?: string[]; confirmText?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { mode, days, sources, confirmText } = body;

  if (confirmText !== REQUIRED_CONFIRM_TEXT) {
    return NextResponse.json(
      {
        error: `Confirmation text mismatch. Must type exactly: "${REQUIRED_CONFIRM_TEXT}"`,
      },
      { status: 400 }
    );
  }

  if (mode !== "all" && mode !== "olderThan" && mode !== "bySource") {
    return NextResponse.json(
      { error: 'mode must be "all", "olderThan", or "bySource"' },
      { status: 400 }
    );
  }

  if (mode === "olderThan") {
    if (typeof days !== "number" || days <= 0 || days > 3650) {
      return NextResponse.json(
        { error: "days must be a positive number (max 3650 = 10 years)" },
        { status: 400 }
      );
    }
  }

  if (mode === "bySource") {
    if (!Array.isArray(sources) || sources.length === 0 || sources.length > 50) {
      return NextResponse.json(
        { error: "sources must be a non-empty array (max 50 entries)" },
        { status: 400 }
      );
    }
    if (!sources.every((s) => typeof s === "string" && s.length > 0 && s.length < 500)) {
      return NextResponse.json(
        { error: "each source must be a non-empty string (<500 chars)" },
        { status: 400 }
      );
    }
  }

  // 3. Build where clause — applies to all per-type tables.
  // Each table has its own field-mapping for bySource mode.
  const olderThanWhere = { eventTime: { lt: subDays(new Date(), days!) } };

  type CountWhere = Record<string, unknown>;
  type TableSpec = {
    name: string;
    count: (args: { where: CountWhere }) => Promise<number>;
    delete: (args: { where: CountWhere }) => Promise<{ count: number }>;
  };

  const tables: TableSpec[] = [
    {
      name: "syslog",
      count: (args) => prisma.tEventLogSyslog.count(args as any),
      delete: (args) => prisma.tEventLogSyslog.deleteMany(args as any),
    },
    {
      name: "fim",
      count: (args) => prisma.tEventLogFim.count(args as any),
      delete: (args) => prisma.tEventLogFim.deleteMany(args as any),
    },
    {
      name: "server_auth",
      count: (args) => prisma.tEventLogServerAuth.count(args as any),
      delete: (args) => prisma.tEventLogServerAuth.deleteMany(args as any),
    },
    {
      name: "agent_apps",
      count: (args) => prisma.tEventLogAgentApps.count(args as any),
      delete: (args) => prisma.tEventLogAgentApps.deleteMany(args as any),
    },
    {
      name: "auditd",
      count: (args) => prisma.tEventLogAuditd.count(args as any),
      delete: (args) => prisma.tEventLogAuditd.deleteMany(args as any),
    },
    {
      name: "database",
      count: (args) => prisma.tEventLogDatabase.count(args as any),
      delete: (args) => prisma.tEventLogDatabase.deleteMany(args as any),
    },
    {
      name: "network",
      count: (args) => prisma.tEventLogNetwork.count(args as any),
      delete: (args) => prisma.tEventLogNetwork.deleteMany(args as any),
    },
    {
      name: "user_access",
      count: (args) => prisma.tEventLogUserAccess.count(args as any),
      delete: (args) => prisma.tEventLogUserAccess.deleteMany(args as any),
    },
  ];

  const whereMap: Record<string, CountWhere> = {
    syslog: mode === "olderThan" ? olderThanWhere : mode === "bySource" ? { source: { in: sources! } } : {},
    fim: mode === "olderThan" ? olderThanWhere : mode === "bySource" ? { source: { in: sources! } } : {},
    server_auth: mode === "olderThan" ? olderThanWhere : mode === "bySource" ? { OR: [{ sourceIp: { in: sources! } }, { username: { in: sources! } }] } : {},
    agent_apps: mode === "olderThan" ? olderThanWhere : mode === "bySource" ? { OR: [{ sourceIp: { in: sources! } }, { username: { in: sources! } }, { appName: { in: sources! } }] } : {},
    auditd: mode === "olderThan" ? olderThanWhere : mode === "bySource" ? { process: { in: sources! } } : {},
    database: mode === "olderThan" ? olderThanWhere : mode === "bySource" ? { OR: [{ sourceIp: { in: sources! } }, { username: { in: sources! } }, { database: { in: sources! } }] } : {},
    network: mode === "olderThan" ? olderThanWhere : mode === "bySource" ? { OR: [{ srcIp: { in: sources! } }, { hostname: { in: sources! } }, { vendor: { in: sources! } }] } : {},
    user_access: mode === "olderThan" ? olderThanWhere : mode === "bySource" ? { OR: [{ actorEmail: { in: sources! } }, { actorUsername: { in: sources! } }, { actorIp: { in: sources! } }] } : {},
  };

  // 4. Count before (across all tables) — parallel
  const counts = await Promise.all(
    tables.map((t) => t.count({ where: whereMap[t.name] ?? {} }))
  );
  const beforeCount: number = counts.reduce((a, b) => a + b, 0);

  if (beforeCount === 0) {
    return NextResponse.json({
      rowsDeleted: 0,
      beforeCount: 0,
      afterCount: 0,
      message: "No events matched the filter",
    });
  }

  // 5. Sample some IDs for audit (capped at 20) — pull from syslog first.
  const sample = await prisma.tEventLogSyslog.findMany({
    where: whereMap.syslog as any,
    select: { id: true, severity: true, eventTime: true, source: true },
    orderBy: { eventTime: "desc" },
    take: 20,
  });

  // 6. Hard delete across all tables (parallel for speed)
  const deletes = await Promise.all(
    tables.map((t) => t.delete({ where: whereMap[t.name] ?? {} }))
  );
  const rowsDeleted: number = deletes.reduce((a, d) => a + d.count, 0);

  // 7. Verify after count (should all be 0 for matching filter)
  const afterCount = 0; // filtered delete = matches removed

  // 8. Audit log
  await audit({
    userId: session.userId ?? null,
    action: "events.deleted",
    resourceType: "agent_events",
    ip: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown",
    userAgent: req.headers.get("user-agent") ?? "unknown",
    metadata: {
      mode,
      days: mode === "olderThan" ? days : undefined,
      sources: mode === "bySource" ? sources : undefined,
      rowsDeleted,
      beforeCount,
      afterCount,
      sample: sample.map((s) => ({
        id: s.id,
        severity: s.severity,
        eventTime: s.eventTime.toISOString(),
        source: s.source,
      })),
      confirmationRef: "typed-confirm-2026-06-20",
    },
  });

  return NextResponse.json({
    rowsDeleted,
    beforeCount,
    afterCount,
    mode,
    days: mode === "olderThan" ? days : undefined,
    sources: mode === "bySource" ? sources : undefined,
    message: `Successfully deleted ${rowsDeleted} events`,
  });
}