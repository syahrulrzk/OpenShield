import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { getSession } from "@/lib/security/rbac";
import { subHours, subDays } from "date-fns";
import Link from "next/link";
import { parseDateFromQuery } from "@/lib/search/query-parsers";
import { ServerEventsContent, type ServerEventsData } from "../../server/_components/server-events-content";

// FIM events: file integrity monitoring — tracks changes to critical files
// (auth configs, system files, etc). The agent computes SHA-256 hashes
// periodically and emits file.change events when a file's content changes.
//
// Source path = the file being monitored (e.g. /etc/passwd)
// Event type = "file.change"
// raw_data.previousHash / currentHash for forensic diff

type Search = { range?: string; status?: string; q?: string };

export default async function FIMEventsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) return null;

  const range = sp.range === "7d" ? "7d" : sp.range === "1h" ? "1h" : "24h";
  const statusFilter = sp.status as "SUCCESS" | "FAILED" | "DENIED" | undefined;
  const q = sp.q?.trim() || "";

  const since =
    range === "1h"
      ? subHours(new Date(), 1)
      : range === "7d"
        ? subDays(new Date(), 7)
        : subHours(new Date(), 24);

  // 2026-06-21 refactor: FIM events now live in tEventLogFim (per-type table).
  const baseWhere: Prisma.TEventLogFimWhereInput = {
    eventTime: { gte: since },
  };

  const andClauses: Prisma.TEventLogFimWhereInput[] = [];
  const dateRange = parseDateFromQuery(q);
  if (dateRange) andClauses.push({ eventTime: dateRange });
  if (q) {
    const textQuery = q
      .replace(/\b\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\b/g, "")
      .replace(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}\b/g, "")
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "")
      .trim();
    if (textQuery) {
      // Search by file path or hash (oldHash/newHash columns in new schema)
      andClauses.push({
        OR: [
          { path: { contains: textQuery, mode: "insensitive" } },
          { message: { contains: textQuery, mode: "insensitive" } },
          { oldHash: { contains: textQuery } },
          { newHash: { contains: textQuery } },
        ],
      });
    }
  }

  const where: Prisma.TEventLogFimWhereInput = {
    ...baseWhere,
    ...(andClauses.length > 0 ? { AND: andClauses } : {}),
  };

  const [rawEvents, total] = await Promise.all([
    prisma.tEventLogFim.findMany({
      where,
      orderBy: { eventTime: "desc" },
      take: 500,
      select: {
        id: true,
        action: true,
        severity: true,
        path: true,
        message: true,
        rawData: true,
        eventTime: true,
        count: true,
        agent: { select: { name: true, hostname: true, ip: true } },
      },
    }),
    prisma.tEventLogFim.count({ where: baseWhere }),
  ]);

  // Status inference for FIM events:
  //   CRITICAL = file modified (integrity violation)
  //   WARN     = file became unreadable
  //   SUCCESS  = baseline established (no change)
  const eventsWithStatus = rawEvents.map((e) => {
    // FIM actions: BASELINE | MODIFIED | CREATED | DELETED | UNREADABLE
    let status: "SUCCESS" | "FAILED" | "DENIED" = "FAILED";
    if (e.action === "BASELINE" || e.severity === "INFO") status = "SUCCESS";
    else if (e.action === "UNREADABLE" || e.severity === "WARN") status = "DENIED";
    else status = "FAILED"; // MODIFIED/CREATED/DELETED + ERROR/CRITICAL = violation
    return { ...e, status };
  });

  const statusCounts = { SUCCESS: 0, FAILED: 0, DENIED: 0 };
  for (const e of eventsWithStatus) {
    statusCounts[e.status]++;
  }

  const filtered = statusFilter
    ? eventsWithStatus.filter((e) => e.status === statusFilter)
    : eventsWithStatus;
  const events = filtered.slice(0, 100);

  const initialData: ServerEventsData = {
    events: events.map((e) => ({
      id: e.id,
      severity: e.severity,
      source: e.path,  // FIM uses path field (renamed from source)
      message: e.message,
      rawData: e.rawData,
      eventTime: e.eventTime.toISOString(),
      count: e.count,
      status: e.status,
      agent: e.agent,
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
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            File Integrity Monitoring
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Perubahan konten file kritis (/etc/passwd, sshd_config, sudoers, dll)
            via SHA-256 hash comparison. Setiap event menyertakan previousHash
            &amp; currentHash untuk forensic diff.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <Link
            href="/dashboard/events/syslog"
            className="text-[var(--muted-foreground)] hover:text-[var(--accent)] transition-colors"
          >
            ← Syslog
          </Link>
          <Link
            href="/dashboard/alerts"
            className="text-[var(--muted-foreground)] hover:text-[var(--accent)] transition-colors"
          >
            Alerts →
          </Link>
        </div>
      </div>

      <ServerEventsContent initialData={initialData} sourceType="fim" />
    </div>
  );
}
