import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { getSession } from "@/lib/security/rbac";
import {
  AlertTriangle,
  AlertCircle,
  Info,
  ShieldAlert,
  Shield,
  ScrollText,
  Clock,
  User,
  Server,
} from "lucide-react";
import { subDays } from "date-fns";
import Link from "next/link";
import { parseDateFromQuery } from "@/lib/search/query-parsers";
import { AuditdEventsContent, type AuditdEventsData } from "./_components/auditd-events-content";

// Auditd event types (the high-signal subset we capture)
const AUDITD_TYPES = [
  "USER_LOGIN",
  "USER_LOGOUT",
  "USER_START",
  "USER_END",
  "USER_AUTH",
  "USER_ACCT",
  "LOGIN",
  "LOGOUT",
  "CONFIG_CHANGE",
  "DAEMON_CONFIG",
  "SERVICE_START",
  "SERVICE_STOP",
  "SYSCALL",
] as const;

const SEVERITY_META: Record<
  string,
  { label: string; color: string; icon: any }
> = {
  INFO: { label: "Info", color: "#10b981", icon: Info },
  WARN: { label: "Warning", color: "#f59e0b", icon: AlertTriangle },
  ERROR: { label: "Error", color: "#ef4444", icon: AlertCircle },
  CRITICAL: { label: "Critical", color: "#dc2626", icon: ShieldAlert },
};

export const dynamic = "force-dynamic";

export default async function AuditdEventsPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string;
    q?: string;
    type?: string;
    severity?: string;
  }>;
}) {
  const session = await getSession();
  if (!session) {
    return null;
  }
  const { range = "24h", q, type, severity } = await searchParams;

  // Range parsing
  let since = subDays(new Date(), 1);
  if (range === "7d") since = subDays(new Date(), 7);
  else if (range === "30d") since = subDays(new Date(), 30);
  else if (range === "1h") since = new Date(Date.now() - 60 * 60 * 1000);

  const baseWhere: Prisma.TEventLogAuditdWhereInput = {
    eventTime: { gte: since },
  };

  const andClauses: Prisma.TEventLogAuditdWhereInput[] = [];

  // Date range parser from query string (e.g. "after:2026-06-19")
  const dateRange = q ? parseDateFromQuery(q) : null;
  if (dateRange) andClauses.push({ eventTime: dateRange });

  // Type filter (from query string or ?type=)
  const typeFilter = type || (q?.match(/\btype:(\S+)/)?.[1] ?? null);
  if (typeFilter && AUDITD_TYPES.includes(typeFilter as any)) {
    andClauses.push({
      rawData: { path: ["auditd_type"], equals: typeFilter },
    });
  }

  // Severity filter
  const sevFilter = severity;
  if (sevFilter && ["INFO", "WARN", "ERROR", "CRITICAL"].includes(sevFilter)) {
    andClauses.push({ severity: sevFilter });
  }

  if (q) {
    const textQuery = q
      .replace(/\b\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\b/g, "")
      .replace(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}\b/g, "")
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "")
      .replace(/\btype:\S+/g, "")
      .trim();
    if (textQuery) {
      const tokens = textQuery.split(/\s+/).filter((t) => t.length > 0);
      for (const token of tokens) {
        andClauses.push({
          OR: [
            { message: { contains: token, mode: "insensitive" } },
            { process: { contains: token, mode: "insensitive" } },
            { uid: { contains: token } },
            { rawData: { path: ["comm"], string_contains: token } },
            { rawData: { path: ["exe"], string_contains: token } },
            { rawData: { path: ["key"], string_contains: token } },
            { rawData: { path: ["addr"], string_contains: token } },
          ],
        });
      }
    }
  }

  const where: Prisma.TEventLogAuditdWhereInput = {
    ...baseWhere,
    ...(andClauses.length > 0 ? { AND: andClauses } : {}),
  };

  const [rawEvents, total] = await Promise.all([
    prisma.tEventLogAuditd.findMany({
      where,
      orderBy: { eventTime: "desc" },
      take: 500,
      select: {
        id: true,
        eventType: true,
        severity: true,
        typeCode: true,
        process: true,
        pid: true,
        uid: true,
        euid: true,
        message: true,
        rawData: true,
        eventTime: true,
        count: true,
        agent: { select: { name: true, hostname: true, ip: true } },
      },
    }),
    prisma.tEventLogAuditd.count({ where: baseWhere }),
  ]);

  const events = rawEvents.map((e) => ({
    ...e,
    eventTime: e.eventTime.toISOString(),
    rawData: e.rawData as any,
  }));

  const initialData: AuditdEventsData = {
    events,
    total,
    range,
    q,
  };

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Shield className="h-6 w-6 text-amber-400" />
            Auditd Events
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Linux kernel audit logs — USER_LOGIN, USER_START, SERVICE_*, SYSCALL (filtered to sudo_use, su_use, file changes).
          </p>
        </div>
        <Link
          href="/dashboard"
          className="text-sm text-slate-400 hover:text-slate-200"
        >
          ← Back to dashboard
        </Link>
      </header>

      <AuditdEventsContent initialData={initialData} />
    </div>
  );
}
