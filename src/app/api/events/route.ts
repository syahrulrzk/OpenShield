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

  // 3. Build where clause
  const where =
    mode === "olderThan"
      ? { eventTime: { lt: subDays(new Date(), days!) } }
      : mode === "bySource"
      ? { source: { in: sources! } }
      : {};

  // 4. Count before (for audit metadata + response)
  const beforeCount = await prisma.agentEvent.count({ where });

  if (beforeCount === 0) {
    return NextResponse.json({
      rowsDeleted: 0,
      beforeCount: 0,
      afterCount: 0,
      message: "No events matched the filter",
    });
  }

  // 5. Sample some IDs for audit (capped at 20 for log size)
  const sample = await prisma.agentEvent.findMany({
    where,
    select: { id: true, severity: true, eventTime: true, source: true },
    orderBy: { eventTime: "desc" },
    take: 20,
  });

  // 6. Hard delete (use deleteMany — much faster than loop)
  const deleteResult = await prisma.agentEvent.deleteMany({ where });

  // 7. Verify after count
  const afterCount = await prisma.agentEvent.count({ where });

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
      rowsDeleted: deleteResult.count,
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
    rowsDeleted: deleteResult.count,
    beforeCount,
    afterCount,
    mode,
    days: mode === "olderThan" ? days : undefined,
    sources: mode === "bySource" ? sources : undefined,
    message: `Successfully deleted ${deleteResult.count} events`,
  });
}