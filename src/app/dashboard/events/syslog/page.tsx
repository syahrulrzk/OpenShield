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
  KeyRound,
  UserCog,
  Settings2,
  Clock,
  Globe,
  Container,
  HardDrive,
  Cpu,
  Package,
  Box,
  ShieldCheck,
  ServerCog,
  Network,
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

// ─────────────────────────────────────────────────────────────────────
// 2026-06-22: Category taxonomy. Must stay in sync with agent.py
// SyslogParser.CATEGORY_MAP + CATEGORY_PREFIXES in API route.ts.
// ─────────────────────────────────────────────────────────────────────
const CATEGORY_PREFIXES: Record<string, string[]> = {
  auth:     ["syslog.sshd", "syslog.sudo", "syslog.su", "syslog.pam", "syslog.privilege", "syslog.session"],
  user:     ["syslog.user_change"],
  service:  ["syslog.service"],
  cron:     ["syslog.cron"],
  network:  ["syslog.network", "syslog.firewall"],
  docker:   ["syslog.docker", "syslog.kubernetes"],
  disk:     ["syslog.disk"],
  hardware: ["syslog.usb", "syslog.hardware"],
  kernel:   ["syslog.kernel"],
  package:  ["syslog.package"],
  system:   ["syslog.line", "syslog.malformed"],
};

const CATEGORIES = [
  { id: "auth",     label: "Auth",     icon: KeyRound,    color: "#ef4444", emoji: "🔐" },
  { id: "user",     label: "Users",    icon: UserCog,     color: "#f97316", emoji: "👤" },
  { id: "service",  label: "Services", icon: ServerCog,   color: "#3b82f6", emoji: "⚙️" },
  { id: "cron",     label: "Cron",     icon: Clock,       color: "#a855f7", emoji: "⏰" },
  { id: "network",  label: "Network",  icon: Network,     color: "#06b6d4", emoji: "🌐" },
  { id: "docker",   label: "Docker",   icon: Container,   color: "#0ea5e9", emoji: "🐳" },
  { id: "disk",     label: "Disk",     icon: HardDrive,   color: "#eab308", emoji: "💾" },
  { id: "kernel",   label: "Kernel",   icon: Cpu,         color: "#dc2626", emoji: "🧠" },
  { id: "hardware", label: "Hardware", icon: Box,         color: "#84cc16", emoji: "🔌" },
  { id: "package",  label: "Packages", icon: Package,     color: "#ec4899", emoji: "📦" },
] as const;

type CategoryId = (typeof CATEGORIES)[number]["id"];

function getCategoryFromEventType(eventType: string): CategoryId {
  for (const cat of CATEGORIES) {
    if (CATEGORY_PREFIXES[cat.id]?.some((p) => eventType.startsWith(p))) {
      return cat.id;
    }
  }
  return "system" as CategoryId;
}

const CATEGORY_META: Record<string, { label: string; color: string; icon: any; emoji: string }> =
  Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

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

type Search = {
  range?: string;
  status?: string;
  q?: string;
  showNoise?: string;
  category?: string;
  // 2026-06-22: dropdown quick-filters (URL params)
  user?: string;
  agent?: string;
  port?: string;
};

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
  // 2026-06-22: category filter (null = all categories)
  const categoryFilter = (sp.category && CATEGORY_PREFIXES[sp.category]) ? sp.category : null;
  const categoryPrefixes = categoryFilter ? CATEGORY_PREFIXES[categoryFilter] : null;
  // 2026-06-22: dropdown quick-filters (URL params)
  const userFilter = sp.user?.trim() || "";
  const agentFilter = sp.agent?.trim() || "";
  const portFilterRaw = sp.port?.trim() || "";
  const portFilterNum = portFilterRaw ? parseInt(portFilterRaw, 10) : null;

  const since =
    range === "1h"
      ? subHours(new Date(), 1)
      : range === "7d"
        ? subDays(new Date(), 7)
        : subHours(new Date(), 24);

  // Base filter: only events from syslog sources
  // Refactored 2026-06-21: query tEventLogSyslog (per-type table) directly
  // instead of agentEvents + filter. Faster + cleaner.
  //
  // 2026-06-22: NOISE FILTER simplified — agent now filters source-side
  // (NOISE_SOURCES in agent.py), so we only need a few remaining patterns
  // to catch edge cases (heartbeat self-report, Next.js dev debug, etc).
  // Removed: "read ", "prisma:query" (these are mostly already filtered).
  // Kept as opt-out fallback via ?showNoise=1.
  const showNoise = sp.showNoise === "1";
  const noisePatterns = [
    "Heartbeat OK",
    "Skip /var/log/",
    "POST /api/agents/heartbeat",
    "raw_params=", // agent edit tool debug (truncated JSON)
    "[context-overflow-", // agent context overflow msg
    "node[", // next.js dev mode
  ];
  const baseWhere: Prisma.TEventLogSyslogWhereInput = {
    eventTime: { gte: since },
    source: { in: [...SYSLOG_SOURCES] },
    ...(showNoise
      ? {}
      : {
          NOT: noisePatterns.map((p) => ({
            description: { contains: p },
          })) as Prisma.TEventLogSyslogWhereInput[],
        }),
    // 2026-06-22: category filter (eventType prefix match)
    ...(categoryPrefixes ? { eventType: { in: categoryPrefixes } } : {}),
    // 2026-06-22: USER / AGENT / PORT quick filters (URL params)
    ...(userFilter ? { user: { equals: userFilter } } : {}),
    ...(agentFilter ? { agentName: { equals: agentFilter } } : {}),
    ...(portFilterNum && !Number.isNaN(portFilterNum)
      ? { port: { equals: portFilterNum } }
      : {}),
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
          { description: { contains: textQuery, mode: "insensitive" } },
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
        description: true,
        eventType: true,
        eventTime: true,
        user: true,
        sourceIp: true,
        agentName: true,
        authDetected: true,
        count: true,
        port: true,
        service: true,
        facility: true,
        priority: true,
        agent: { select: { name: true, hostname: true, ip: true } },
      },
    }),
    prisma.tEventLogSyslog.count({ where: baseWhere }),
  ]);

  const syslogEvents = rawEvents.filter((e) => isSyslogEvent(e.source));
  // 2026-06-22: synthesize a `message` alias for getEventStatus + synthesize
  // rawData from the flat columns so downstream helpers keep working.
  // Also derive `category` from eventType prefix for badge rendering.
  const eventsWithStatus = syslogEvents.map((e) => ({
    ...e,
    message: e.description,
    rawData: {
      eventKind: e.eventType,
      user: e.user,
      ip: e.sourceIp,
      authDetected: e.authDetected,
    },
    status: getEventStatus(e.severity, e.description),
    // 2026-06-22: category for UI badge + filter chip
    category: getCategoryFromEventType(e.eventType ?? "syslog.line"),
  }));

  const statusCounts: Record<EventStatus, number> = {
    SUCCESS: 0,
    FAILED: 0,
    DENIED: 0,
  };
  // Count by syslog eventKind (parsed from raw_data.eventKind by agent).
  // 2026-06-22: SyslogParser now emits eventKind + authDetected in raw_data.
  // Source-side filtering removes noise (systemd/dockerd/python3/etc) — so
  // we no longer need the keyword-based noise filter from before.
  const kindCounts: Record<string, number> = {};
  let authCount = 0;
  // 2026-06-22: also count by category (for top stats counter)
  const categoryCounts: Record<string, number> = Object.fromEntries(
    CATEGORIES.map((c) => [c.id, 0])
  );
  // 2026-06-22: collect top values for USER / AGENT / PORT dropdowns.
  const userCounts: Record<string, number> = {};
  const agentCounts: Record<string, number> = {};
  const portCounts: Record<string, number> = {};
  for (const e of eventsWithStatus) {
    statusCounts[e.status]++;
    // 2026-06-22: read eventType + authDetected from flat columns directly
    if (e.eventType && e.eventType.startsWith("syslog.")) {
      kindCounts[e.eventType] = (kindCounts[e.eventType] ?? 0) + 1;
    }
    if (e.authDetected === true) authCount++;
    // 2026-06-22: count by category for stats display
    const cat = getCategoryFromEventType(e.eventType ?? "syslog.line");
    categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
    // 2026-06-22: count for dropdown filter options
    if (e.user) userCounts[e.user] = (userCounts[e.user] ?? 0) + 1;
    const agentLabel = e.agentName || e.agent?.name;
    if (agentLabel) agentCounts[agentLabel] = (agentCounts[agentLabel] ?? 0) + 1;
    if (e.port !== null && e.port !== undefined) {
      portCounts[String(e.port)] = (portCounts[String(e.port)] ?? 0) + 1;
    }
  }
  const topN = (counts: Record<string, number>, n: number) =>
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([value, count]) => ({ value, label: value, count }));

  const filtered = statusFilter
    ? eventsWithStatus.filter((e) => e.status === statusFilter)
    : eventsWithStatus;
  const events = filtered.slice(0, 100);

  const initialData: ServerEventsData = {
    events: events.map((e) => ({
      ...e,
      eventTime: e.eventTime.toISOString(),
    })),
    total,
    displayed: events.length,
    filteredTotal: filtered.length,
    statusCounts,
    statusFilter: statusFilter ?? "all",
    range,
    q,
    hideRevoked: false,
    showNoise,
    kindCounts,
    authCount,
    categoryCounts,
    activeCategory: categoryFilter,
    // 2026-06-22: dropdown filter options + currently-applied value
    userOptions: topN(userCounts, 15),
    agentOptions: topN(agentCounts, 10),
    portOptions: topN(portCounts, 10),
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

      {/* 2026-06-22: Category stats counter — quick scan of event distribution */}
      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-10 gap-2">
        <Link
          href="/dashboard/events/syslog"
          className={`flex flex-col items-center gap-1 p-3 rounded-lg border transition-all hover:scale-[1.02] ${
            !categoryFilter
              ? "border-[var(--accent)] bg-[var(--accent)]/10"
              : "border-[var(--border)] bg-[var(--card)]/50 hover:border-[var(--accent)]/50"
          }`}
        >
          <span className="text-xl font-bold text-zinc-100">{total}</span>
          <span className="text-[10px] text-[var(--muted-foreground)] uppercase tracking-wider">
            All
          </span>
        </Link>
        {CATEGORIES.map((cat) => {
          const count = categoryCounts[cat.id] ?? 0;
          const isActive = categoryFilter === cat.id;
          const Icon = cat.icon;
          return (
            <Link
              key={cat.id}
              href={`/dashboard/events/syslog?category=${cat.id}`}
              className={`flex flex-col items-center gap-1 p-3 rounded-lg border transition-all hover:scale-[1.02] ${
                isActive
                  ? "border-[var(--accent)] bg-[var(--accent)]/10"
                  : "border-[var(--border)] bg-[var(--card)]/50 hover:border-[var(--accent)]/50"
              } ${count === 0 ? "opacity-40" : ""}`}
              title={`${cat.label} events (${count})`}
            >
              <Icon
                className="h-4 w-4"
                style={{ color: isActive ? "var(--accent)" : cat.color }}
              />
              <span className="text-lg font-bold text-zinc-100">{count}</span>
              <span className="text-[10px] text-[var(--muted-foreground)] uppercase tracking-wider">
                {cat.label}
              </span>
            </Link>
          );
        })}
      </div>

      {/* 2026-06-22: Active category banner */}
      {categoryFilter && (
        <div className="flex items-center justify-between p-3 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-[var(--muted-foreground)]">Filter aktif:</span>
            <span
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium"
              style={{
                backgroundColor: `${CATEGORY_META[categoryFilter]?.color}20`,
                color: CATEGORY_META[categoryFilter]?.color,
              }}
            >
              {CATEGORY_META[categoryFilter]?.emoji}{" "}
              {CATEGORY_META[categoryFilter]?.label}
            </span>
            <span className="text-zinc-400 font-mono">{total} events</span>
          </div>
          <Link
            href="/dashboard/events/syslog"
            className="text-xs text-[var(--muted-foreground)] hover:text-[var(--accent)] transition-colors"
          >
            ✕ Clear filter
          </Link>
        </div>
      )}

      <ServerEventsContent initialData={initialData} sourceType="syslog" />
    </div>
  );
}
