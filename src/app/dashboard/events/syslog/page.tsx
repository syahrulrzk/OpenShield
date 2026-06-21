import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { getSession } from "@/lib/security/rbac";
import {
  AlertTriangle,
  AlertCircle,
  Info,
  ShieldAlert,
  Terminal,
  Copy,
  ScrollText,
  CheckCircle2,
  XCircle,
  ShieldOff,
} from "lucide-react";
import { subHours, subDays } from "date-fns";
import Link from "next/link";
import { parseDateFromQuery } from "@/lib/search/query-parsers";
import { ServerEventsContent, type ServerEventsData } from "../../server/_components/server-events-content";

// Source paths considered "syslog" (BSD-style syslog)
const SYSLOG_SOURCES = [
  "/var/log/syslog",
  "/var/log/messages",
  "/var/log/syslog.1",
  "/var/log/messages.1",
] as const;

function isSyslogEvent(source: string): boolean {
  return SYSLOG_SOURCES.some(
    (s) => source === s || source.endsWith(s.split("/").pop()!)
  );
}

const SEVERITY_META: Record<
  string,
  { label: string; color: string; icon: any }
> = {
  INFO: { label: "Info", color: "#10b981", icon: Info },
  WARN: { label: "Warning", color: "#f59e0b", icon: AlertTriangle },
  ERROR: { label: "Error", color: "#ef4444", icon: AlertCircle },
  CRITICAL: { label: "Critical", color: "#dc2626", icon: ShieldAlert },
};

type EventStatus = "SUCCESS" | "FAILED" | "DENIED";

const STATUS_META: Record<
  EventStatus,
  { label: string; color: string; icon: any }
> = {
  SUCCESS: { label: "Success", color: "#10b981", icon: CheckCircle2 },
  FAILED: { label: "Failed", color: "#ef4444", icon: XCircle },
  DENIED: { label: "Denied", color: "#f59e0b", icon: ShieldOff },
};

function getEventStatus(severity: string, message: string): EventStatus {
  const lower = message.toLowerCase();
  if (/\b(den(y|ied)|blocked|refused|not\s+allowed|rejected)\b/i.test(lower)) {
    return "DENIED";
  }
  if (
    /\b(fail(ed|ure)?|invalid|unsuccessful|wrong|incorrect|panic|err)\b/i.test(
      lower
    )
  ) {
    return "FAILED";
  }
  return "SUCCESS";
}

type Search = { range?: string; status?: string; q?: string };

export default async function SyslogEventsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) return null;

  const range = sp.range === "7d" ? "7d" : sp.range === "1h" ? "1h" : "24h";
  const statusFilter = sp.status as EventStatus | undefined;
  const q = sp.q?.trim() || "";

  const since =
    range === "1h"
      ? subHours(new Date(), 1)
      : range === "7d"
        ? subDays(new Date(), 7)
        : subHours(new Date(), 24);

  // Base filter: only events from syslog sources
  // Refactored 2026-06-21: query tEventLogSyslog (per-type table) directly
  // instead of agentEvents + filter. Faster + cleaner.
  const baseWhere: Prisma.TEventLogSyslogWhereInput = {
    eventTime: { gte: since },
    source: { in: [...SYSLOG_SOURCES] },
  };

  // Build search filters (same pattern as /api/events/server)
  const andClauses: Prisma.TEventLogSyslogWhereInput[] = [];
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
          { source: { contains: textQuery, mode: "insensitive" } },
          { process: { contains: textQuery, mode: "insensitive" } },
          { hostname: { contains: textQuery, mode: "insensitive" } },
        ],
      });
    }
  }

  const where: Prisma.TEventLogSyslogWhereInput = {
    ...baseWhere,
    ...(andClauses.length > 0 ? { AND: andClauses } : {}),
  };

  const [rawEvents, total] = await Promise.all([
    prisma.tEventLogSyslog.findMany({
      where,
      orderBy: { eventTime: "desc" },
      take: 500,
      select: {
        id: true,
        severity: true,
        source: true,
        process: true,
        message: true,
        rawData: true,
        eventTime: true,
        count: true,
        agent: { select: { name: true, hostname: true, ip: true } },
      },
    }),
    prisma.tEventLogSyslog.count({ where: baseWhere }),
  ]);

  const syslogEvents = rawEvents.filter((e) => isSyslogEvent(e.source));
  const eventsWithStatus = syslogEvents.map((e) => ({
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

  const initialData: ServerEventsData = {
    events: events.map((e) => ({
      ...e,
      eventTime: e.eventTime.toISOString(),
      rawData: e.rawData as any,
    })),
    total,
    displayed: events.length,
    filteredTotal: filtered.length,
    statusCounts,
    statusFilter: statusFilter ?? "all",
    range,
    q,
    hideRevoked: false,
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Syslog Events
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            System logs dari /var/log/syslog & /var/log/messages (filtered:
            noise processes di-skip — kernel, cron, systemd)
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <Link
            href="/dashboard/server"
            className="text-[var(--muted-foreground)] hover:text-[var(--accent)] transition-colors"
          >
            ← Server Auth
          </Link>
          <Link
            href="/dashboard/database"
            className="text-[var(--muted-foreground)] hover:text-[var(--accent)] transition-colors"
          >
            Database →
          </Link>
        </div>
      </div>

      <ServerEventsContent initialData={initialData} sourceType="syslog" />
    </div>
  );
}
