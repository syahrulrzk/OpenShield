import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/security/rbac";
import { subHours, subDays } from "date-fns";

const CATEGORY_PREFIXES: Record<string, string[]> = {
  auth: ["syslog.sshd", "syslog.sudo", "syslog.su", "syslog.pam", "syslog.privilege", "syslog.session"],
  user: ["syslog.user_change"],
  service: ["syslog.service"],
  cron: ["syslog.cron"],
  network: ["syslog.network", "syslog.firewall"],
  docker: ["syslog.docker", "syslog.kubernetes"],
  disk: ["syslog.disk"],
  hardware: ["syslog.usb", "syslog.hardware"],
  kernel: ["syslog.kernel"],
  package: ["syslog.package"],
  system: ["syslog.line", "syslog.malformed"],
};

function getCategoryFromEventType(eventType: string): string {
  for (const [cat, prefixes] of Object.entries(CATEGORY_PREFIXES)) {
    if (prefixes.some(p => eventType.startsWith(p))) {
      return cat;
    }
  }
  return "system";
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = req.nextUrl.searchParams;
  const range = searchParams.get("range") ?? "24h";
  const q = searchParams.get("q") ?? "";
  const showNoise = searchParams.get("showNoise") === "1";
  const category = searchParams.get("category") ?? null;
  const severity = searchParams.get("severity") ?? null;
  const user = searchParams.get("user") ?? "";
  const agent = searchParams.get("agent") ?? "";
  const port = searchParams.get("port") ?? "";

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

  const categoryPrefixes = category ? CATEGORY_PREFIXES[category] : null;

  const where: any = {
    eventTime: { gte: since },
    source: { in: ["/var/log/syslog", "/var/log/messages", "/var/log/syslog.1", "/var/log/messages.1"] },
    ...(!showNoise
      ? {
          NOT: noisePatterns.map((p) => ({
            description: { contains: p },
          })),
        }
      : {}),
    ...(categoryPrefixes ? { 
        OR: categoryPrefixes.map(p => ({ eventType: { startsWith: p } })) 
      } : {}),
    ...(severity ? { severity: { equals: severity.toUpperCase() } } : {}),
    ...(user ? { user: { equals: user } } : {}),
    ...(agent ? { agentName: { equals: agent } } : {}),
    ...(port ? { port: { equals: parseInt(port, 10) } } : {}),
  };

  if (q) {
    const textQuery = q
      .replace(/\b\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\b/g, "")
      .replace(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}\b/g, "")
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "")
      .trim();
    if (textQuery) {
      where.OR = [
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
      where,
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
    prisma.tEventLogSyslog.count({ where }),
    prisma.tEventLogSyslog.findMany({
      where: {
        eventTime: { gte: since },
        source: { in: ["/var/log/syslog", "/var/log/messages", "/var/log/syslog.1", "/var/log/messages.1"] },
        ...(!showNoise
          ? {
              NOT: noisePatterns.map((p) => ({
                description: { contains: p },
              })),
            }
          : {}),
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
    Object.keys(CATEGORY_PREFIXES).map((c) => [c, 0])
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

  return NextResponse.json({
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
    activeCategory: category,
    activeSeverity: severity,
    userOptions: topN(userCounts, 15),
    agentOptions: topN(agentCounts, 10),
    portOptions: topN(portCounts, 10),
    userFilter: user,
    agentFilter: agent,
    portFilter: port,
  });
}
