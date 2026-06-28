import { prisma } from "@/lib/db";
import { getSession } from "@/lib/security/rbac";
import {
  AlertTriangle,
  AlertCircle,
  Info,
  ShieldAlert,
  KeyRound,
  UserCog,
  Clock,
  Container,
  HardDrive,
  Cpu,
  Package,
  Box,
  ServerCog,
  Network,
  Activity,
} from "lucide-react";
import { subHours, subDays } from "date-fns";
import Link from "next/link";
import { SyslogEventsContent, type SyslogEventsData } from "./_components/SyslogEventsContent";

const SYSLOG_SOURCES = [
  "/var/log/syslog",
  "/var/log/messages",
  "/var/log/syslog.1",
  "/var/log/messages.1",
] as const;

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

function getCategoryFromEventType(eventType: string): string {
  for (const cat of CATEGORIES) {
    if (CATEGORY_PREFIXES[cat.id]?.some((p) => eventType.startsWith(p))) {
      return cat.id;
    }
  }
  return "system";
}

type Search = {
  range?: string;
  q?: string;
  showNoise?: string;
  category?: string;
  severity?: string;
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
  const q = sp.q?.trim() || "";
  const showNoise = sp.showNoise === "1";
  const categoryFilter = (sp.category && CATEGORY_PREFIXES[sp.category]) ? sp.category : null;
  const categoryPrefixes = categoryFilter ? CATEGORY_PREFIXES[categoryFilter] : null;
  const severityFilter = sp.severity?.trim() || "";
  const userFilter = sp.user?.trim() || "";
  const agentFilter = sp.agent?.trim() || "";
  const portFilter = sp.port?.trim() || "";

  const since =
    range === "1h"
      ? subHours(new Date(), 1)
      : range === "7d"
      ? subDays(new Date(), 7)
      : subHours(new Date(), 24);

  const noisePatterns = [
    "Heartbeat OK",
    "Skip /var/log/",
    "POST /api/agents/heartbeat",
    "raw_params=",
    "[context-overflow-",
    "node[",
  ];

  const baseWhere: any = {
    eventTime: { gte: since },
    source: { in: [...SYSLOG_SOURCES] },
    ...(!showNoise ? { NOT: noisePatterns.map((p) => ({ description: { contains: p } })) } : {}),
    ...(categoryPrefixes ? { 
        OR: categoryPrefixes.map(p => ({ eventType: { startsWith: p } })) 
      } : {}),
    ...(severityFilter ? { severity: { equals: severityFilter.toUpperCase() } } : {}),
    ...(userFilter ? { user: { equals: userFilter } } : {}),
    ...(agentFilter ? { agentName: { equals: agentFilter } } : {}),
    ...(portFilter ? { port: { equals: parseInt(portFilter, 10) } } : {}),
  };

  if (q) {
    const textQuery = q
      .replace(/\b\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\b/g, "")
      .replace(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}\b/g, "")
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "")
      .trim();
    if (textQuery) {
      baseWhere.OR = [
        { description: { contains: textQuery, mode: "insensitive" } },
        { source: { contains: textQuery, mode: "insensitive" } },
        { process: { contains: textQuery, mode: "insensitive" } },
        { user: { contains: textQuery, mode: "insensitive" } },
        { sourceIp: { contains: textQuery, mode: "insensitive" } },
      ];
    }
  }

  const [rawEvents, total, allRawEvents] = await Promise.all([
    prisma.tEventLogSyslog.findMany({
      where: baseWhere,
      orderBy: { eventTime: "desc" },
      take: 200,
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
      },
    }),
    prisma.tEventLogSyslog.count({ where: baseWhere }),
    prisma.tEventLogSyslog.findMany({
      where: {
        eventTime: { gte: since },
        source: { in: [...SYSLOG_SOURCES] },
        ...(!showNoise ? { NOT: noisePatterns.map((p) => ({ description: { contains: p } })) } : {}),
      },
      select: { eventType: true },
    }),
  ]);

  const events = rawEvents.map((e) => ({
    ...e,
    eventTime: e.eventTime.toISOString(),
    category: getCategoryFromEventType(e.eventType ?? "syslog.line"),
  }));

  const kindCounts: Record<string, number> = {};
  let authCount = 0;
  const categoryCounts: Record<string, number> = Object.fromEntries(
    CATEGORIES.map((c) => [c.id, 0])
  );
  const severityCounts: Record<string, number> = { info: 0, warning: 0, error: 0, critical: 0 };
  const userCounts: Record<string, number> = {};
  const agentCounts: Record<string, number> = {};
  const portCounts: Record<string, number> = {};

  for (const e of events) {
    if (e.eventType && e.eventType.startsWith("syslog.")) {
      kindCounts[e.eventType] = (kindCounts[e.eventType] ?? 0) + 1;
    }
    if (e.authDetected) authCount++;
    if (e.severity) {
      const lowerSeverity = e.severity.toLowerCase();
      severityCounts[lowerSeverity] = (severityCounts[lowerSeverity] ?? 0) + 1;
    }
    if (e.user) userCounts[e.user] = (userCounts[e.user] ?? 0) + 1;
    if (e.agentName) agentCounts[e.agentName] = (agentCounts[e.agentName] ?? 0) + 1;
    if (e.port !== null && e.port !== undefined) {
      portCounts[String(e.port)] = (portCounts[String(e.port)] ?? 0) + 1;
    }
  }

  // Calculate category counts from all events
  for (const e of allRawEvents) {
    const cat = getCategoryFromEventType(e.eventType ?? "syslog.line");
    categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
  }

  const topN = (counts: Record<string, number>, n: number) =>
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([value, count]) => ({ value, label: value, count }));

  const initialData: SyslogEventsData = {
    events,
    total,
    displayed: events.length,
    filteredTotal: events.length,
    range,
    q,
    showNoise,
    kindCounts,
    authCount,
    categoryCounts,
    severityCounts,
    activeCategory: categoryFilter,
    activeSeverity: severityFilter,
    userOptions: topN(userCounts, 15),
    agentOptions: topN(agentCounts, 10),
    portOptions: topN(portCounts, 10),
    userFilter,
    agentFilter,
    portFilter,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Syslog Events
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            System logs dari /var/log/syslog & /var/log/messages
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <Link href="/dashboard/server" className="text-zinc-500 hover:text-emerald-400 transition-colors">
            ← Server Auth
          </Link>
          <Link href="/dashboard/database" className="text-zinc-500 hover:text-emerald-400 transition-colors">
            Database →
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-5 sm:grid-cols-7 lg:grid-cols-11 gap-2">
        <Link
          href="/dashboard/events/syslog"
          className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg border transition-all hover:scale-[1.02] ${
            !categoryFilter
              ? "border-emerald-500 bg-emerald-500/10"
              : "border-zinc-700 bg-zinc-800/50 hover:border-emerald-500/50"
          }`}
        >
          <Activity className="h-4 w-4" style={{ color: !categoryFilter ? "#10b981" : "#52525b" }} />
          <span className="text-xl font-bold text-zinc-100">{total}</span>
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider">All</span>
        </Link>
        {CATEGORIES.map((cat) => {
          const count = categoryCounts[cat.id] ?? 0;
          const isActive = categoryFilter === cat.id;
          const Icon = cat.icon;
          return (
            <Link
              key={cat.id}
              href={`/dashboard/events/syslog?category=${cat.id}`}
              className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg border transition-all hover:scale-[1.02] ${
                isActive
                  ? "border-emerald-500 bg-emerald-500/10"
                  : "border-zinc-700 bg-zinc-800/50 hover:border-emerald-500/50"
              } ${count === 0 && !isActive ? "opacity-40" : ""}`}
              title={`${cat.label} events (${count})`}
            >
              <Icon className="h-4 w-4" style={{ color: isActive ? "#10b981" : cat.color }} />
              <span className="text-lg font-bold text-zinc-100">{count}</span>
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">{cat.label}</span>
            </Link>
          );
        })}
      </div>

      {(categoryFilter || severityFilter) && (
        <div className="flex items-center justify-between p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
          <div className="flex items-center gap-2 text-sm flex-wrap">
            <span className="text-zinc-500">Filter aktif:</span>
            {categoryFilter && (
              <span
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium"
                style={{
                  backgroundColor: `${CATEGORIES.find(c => c.id === categoryFilter)?.color}20`,
                  color: CATEGORIES.find(c => c.id === categoryFilter)?.color,
                }}
              >
                {CATEGORIES.find(c => c.id === categoryFilter)?.emoji} {CATEGORIES.find(c => c.id === categoryFilter)?.label}
              </span>
            )}
            {severityFilter && (
              <span
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium"
                style={{
                  backgroundColor: 
                    severityFilter === 'critical' ? '#dc262620' : 
                    severityFilter === 'error' ? '#ef444420' : 
                    severityFilter === 'warning' ? '#eab30820' : '#22c55e20',
                  color: 
                    severityFilter === 'critical' ? '#dc2626' : 
                    severityFilter === 'error' ? '#ef4444' : 
                    severityFilter === 'warning' ? '#eab308' : '#22c55e',
                }}
              >
                {severityFilter === 'critical' ? '🚨' : severityFilter === 'error' ? '❌' : severityFilter === 'warning' ? '⚠️' : 'ℹ️'} {severityFilter.charAt(0).toUpperCase() + severityFilter.slice(1)}
              </span>
            )}
            <span className="text-zinc-400 font-mono">{total} events</span>
          </div>
          <Link 
            href={categoryFilter ? 
              `/dashboard/events/syslog?${new URLSearchParams(sp).toString().replace(`&category=${categoryFilter}`, '').replace(`category=${categoryFilter}`, '')}` :
              severityFilter ? 
              `/dashboard/events/syslog?${new URLSearchParams(sp).toString().replace(`&severity=${severityFilter}`, '').replace(`severity=${severityFilter}`, '')}` :
              '/dashboard/events/syslog'
            } 
            className="text-xs text-zinc-500 hover:text-emerald-400 transition-colors"
          >
            ✕ Clear filter
          </Link>
        </div>
      )}

      <SyslogEventsContent initialData={initialData} />
    </div>
  );
}
