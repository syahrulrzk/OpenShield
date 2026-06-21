import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { getSession } from "@/lib/security/rbac";
import {
  AlertTriangle,
  AlertCircle,
  Info,
  ShieldAlert,
  Terminal,
  FolderOpen,
  Copy,
  HardDrive,
  Cloud,
  Shield,
  Activity,
  CheckCircle2,
  XCircle,
  ShieldOff,
} from "lucide-react";
import { subHours, subDays } from "date-fns";
import Link from "next/link";
import { parseDateFromQuery, parseIpFromQuery } from "@/lib/search/query-parsers";
import { ServerEventsContent, type ServerEventsData } from "./_components/server-events-content";
import { DeleteEventsButton } from "./_components/delete-events-button";

type Search = { range?: string; status?: string; q?: string; hideRevoked?: string };

// Server-side log paths
const SERVER_SOURCES = [
  "/var/log/syslog",
  "/var/log/messages",
  "/var/log/kern.log",
  "/var/log/daemon.log",
  "/var/log/user.log",
  "/var/log/cron.log",
  "/var/log/nginx/access.log",
  "/var/log/nginx/error.log",
  "/var/log/apache2/access.log",
  "/var/log/apache2/error.log",
];

function isServerEvent(source: string): boolean {
  // Show both server log sources (syslog, nginx, cron, etc) AND SSH log
  // sources (auth.log, secure) on the Server page.
  if (SERVER_SOURCES.includes(source)) return true;
  return true;
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

/**
 * Status mapping for auth/access events. Distinct from severity — severity is
 * the LOG LEVEL (info/warn/error), status is the OUTCOME of the auth attempt
 * (success/failed/denied).
 */
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
  if (/\b(fail(ed|ure)?|invalid|unsuccessful|wrong|incorrect)\b/i.test(lower)) {
    return "FAILED";
  }
  if (
    /\b(ok|accept(ed)?|success(ful)?|logged\s+in|signed\s+in|authenticated)\b/i.test(
      lower,
    )
  ) {
    return "SUCCESS";
  }
  if (severity === "INFO") return "SUCCESS";
  if (severity === "WARN" || severity === "ERROR" || severity === "CRITICAL") {
    return "FAILED";
  }
  return "FAILED";
}

function getEventUser(rawData: unknown, message: string): string | null {
  if (rawData && typeof rawData === "object" && !Array.isArray(rawData)) {
    const rd = rawData as Record<string, unknown>;
    const u = rd.user ?? rd.username ?? rd.account ?? rd.subject ?? rd.targetUser;
    if (typeof u === "string" && u.length > 0) return u;
  }
  const kvMatch = message.match(/\buser=([a-zA-Z0-9._\-\[\]]+)/);
  if (kvMatch) return kvMatch[1];
  const forMatch = message.match(
    /\bfor\s+(?:invalid\s+user\s+)?([a-zA-Z0-9._\-\[\]]+)\s+from\b/i,
  );
  if (forMatch) return forMatch[1];
  const userMatch = message.match(
    /\buser\s+([a-zA-Z0-9._\-\[\]]+)\s+(?:not\s+in|is\s+not|from)/i,
  );
  if (userMatch) return userMatch[1];
  return null;
}

function getEventIp(rawData: unknown, message: string): string | null {
  if (rawData && typeof rawData === "object" && !Array.isArray(rawData)) {
    const ip = (rawData as Record<string, unknown>).ip;
    if (typeof ip === "string" && ip.length > 0 && ip !== "0.0.0.0") return ip;
  }
  const m =
    message.match(/\b((?:\d{1,3}\.){3}\d{1,3})\b/) ??
    message.match(/from\s+([0-9a-fA-F:]+)\s+/);
  if (m) {
    const candidate = m[1];
    if (/^\d+\.\d+\.\d+\.\d+$/.test(candidate)) {
      const parts = candidate.split(".").map(Number);
      if (parts.every((p) => p >= 0 && p <= 255)) return candidate;
    } else if (candidate.includes(":")) return candidate;
  }
  return null;
}

export type EventService =
  | "SSH"
  | "SFTP"
  | "SCP"
  | "FTP"
  | "SUDO"
  | "WEB"
  | "SYSTEMD"
  | "RDP"
  | "WINRM"
  | "SMB"
  | "IIS"
  | "EVENTLOG";

type ServiceMeta = { label: string; color: string; icon: any };

export const SERVICE_META: Record<EventService, ServiceMeta> = {
  SSH: { label: "SSH", color: "#10b981", icon: Terminal },
  SFTP: { label: "SFTP", color: "#3b82f6", icon: FolderOpen },
  SCP: { label: "SCP", color: "#8b5cf6", icon: Copy },
  FTP: { label: "FTP", color: "#f97316", icon: HardDrive },
  SUDO: { label: "SUDO", color: "#eab308", icon: Shield },
  WEB: { label: "WEB", color: "#06b6d4", icon: Cloud },
  SYSTEMD: { label: "SYSTEMD", color: "#94a3b8", icon: Activity },
  RDP: { label: "RDP", color: "#ec4899", icon: Terminal },
  WINRM: { label: "WINRM", color: "#a855f7", icon: Cloud },
  SMB: { label: "SMB", color: "#0ea5e9", icon: HardDrive },
  IIS: { label: "IIS", color: "#06b6d4", icon: Cloud },
  EVENTLOG: { label: "EVTLOG", color: "#64748b", icon: Activity },
};

function getEventType(
  rawData: unknown,
  message: string,
  source: string,
): EventService | null {
  if (rawData && typeof rawData === "object" && !Array.isArray(rawData)) {
    const s = (rawData as Record<string, unknown>).service;
    if (typeof s === "string" && s in SERVICE_META) return s as EventService;
  }
  const src = source.toLowerCase();
  const msg = message;

  if (src.includes("microsoft-windows-terminalservices")) return "RDP";
  if (src.includes("microsoft-windows-winrm")) return "WINRM";
  if (
    src === "smbserver" ||
    src.startsWith("/var/log/samba") ||
    src.includes("security.evtx") ||
    src.includes("security")
  ) {
    if (/\bsmb\b|\bshare\b|\\device\\/.test(msg)) return "SMB";
  }
  if (
    src.includes("iis") ||
    src.startsWith("c:\\inetpub\\logs") ||
    src.includes("w3svc")
  ) {
    return "IIS";
  }
  if (
    src.endsWith(".evtx") ||
    src.includes("eventlog") ||
    src.includes("winevt")
  ) {
    if (/terminalservices|rdp|remote desktop/i.test(msg)) return "RDP";
    if (/winrm|powershell remoting|wsman/i.test(msg)) return "WINRM";
    return "EVENTLOG";
  }
  if (
    src === "ftp" ||
    src.includes("/var/log/vsftpd") ||
    src.includes("/var/log/proftpd") ||
    src.includes("/var/log/pure-ftpd")
  ) {
    return "FTP";
  }
  if (
    src.endsWith("sudo.log") ||
    src.includes("/var/log/sudo") ||
    /\bsudo:\s+/.test(msg)
  ) {
    return "SUDO";
  }
  if (src.endsWith("auth.log") || src.endsWith("secure") || src.includes("sshd")) {
    if (/subsystem request.*sftp/i.test(msg)) return "SFTP";
    if (/command="?(?:scp|rsync|sftp)"?\b/i.test(msg)) return "SCP";
    if (/session (?:opened|closed) for user/i.test(msg)) return "SSH";
    return "SSH";
  }
  if (
    src.includes("nginx") ||
    src.includes("apache") ||
    src.includes("httpd") ||
    /\b(?:GET|POST|PUT|DELETE|PATCH)\s+\//i.test(msg)
  ) {
    return "WEB";
  }
  if (src.endsWith("syslog") || src.endsWith("messages") || src.includes("systemd")) {
    return "SYSTEMD";
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// Page
// ════════════════════════════════════════════════════════════════════════════

export default async function ServerEventsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await getSession();
  if (!session) return null;
  const sp = await searchParams;

  // Time window — but if the user searches by date (in `q`), use a generous
  // window instead of the user-selected `range`. Otherwise the 24h range
  // would exclude earlier events that match the date filter.
  const range = sp.range || "24h";
  const q = sp.q?.trim() || "";
  const hasDateInQuery = !!parseDateFromQuery(q);
  const since =
    hasDateInQuery
      ? subDays(new Date(), 365) // generous fallback for date searches
      : range === "1h"
        ? subHours(new Date(), 1)
        : range === "7d"
          ? subDays(new Date(), 7)
          : subDays(new Date(), 1);

  const statusFilter: EventStatus | undefined =
    sp.status && ["SUCCESS", "FAILED", "DENIED"].includes(sp.status.toUpperCase())
      ? (sp.status.toUpperCase() as EventStatus)
      : undefined;

  // Audit trail pattern (SOC 2 / ISO 27001): by default, hide events from
  // agents that have been revoked (soft-deleted via revokedAt). The events
  // themselves remain in the DB for forensic/audit purposes — we just don't
  // show them in the live operational view. Admins can opt-in via ?hideRevoked=0.
  const hideRevoked = sp.hideRevoked !== "0";

  // 2026-06-21 refactor: server auth events now live in tEventLogServerAuth
  // (unified table for agent-side sshd + poller-side auth). Direct query.
  const baseWhere: Prisma.TEventLogServerAuthWhereInput = {
    eventTime: { gte: since },
    ...(hideRevoked ? { agent: { revokedAt: null } } : {}),
  };

  // Build search filters — same logic as /api/events/server so SSR matches
  // client-side fetches exactly. Field path mappings: message → raw, user → username, ip → sourceIp.
  const andClauses: Prisma.TEventLogServerAuthWhereInput[] = [];
  const dateRange = parseDateFromQuery(q);
  if (dateRange) andClauses.push({ eventTime: dateRange });
  const ipMatch = parseIpFromQuery(q);
  if (ipMatch) {
    andClauses.push({
      OR: [
        { sourceIp: { contains: ipMatch } },
        { raw: { contains: ipMatch } },
      ],
    });
  }
  if (q) {
    const textQuery = q
      .replace(/\b\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\b/g, "")
      .replace(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}\b/g, "")
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "")
      .trim();
    if (textQuery) {
      andClauses.push({
        OR: [
          { raw: { contains: textQuery, mode: "insensitive" } },
          { username: { contains: textQuery, mode: "insensitive" } },
          { sourceIp: { contains: textQuery } },
          { agent: { name: { contains: textQuery, mode: "insensitive" } } },
          { agent: { hostname: { contains: textQuery, mode: "insensitive" } } },
        ],
      });
    }
  }
  const where: Prisma.TEventLogServerAuthWhereInput = {
    ...baseWhere,
    ...(andClauses.length > 0 ? { AND: andClauses } : {}),
  };

  const [rawEvents, total] = await Promise.all([
    prisma.tEventLogServerAuth.findMany({
      where,
      orderBy: { eventTime: "desc" },
      take: 500,
      select: {
        id: true,
        username: true,
        sourceIp: true,
        status: true,
        method: true,
        country: true,
        raw: true,
        eventTime: true,
        count: true,
        agent: { select: { name: true, hostname: true, ip: true } },
      },
    }),
    prisma.tEventLogServerAuth.count({ where: baseWhere }),
  ]);

  // Map tEventLogServerAuth → ServerEvent-like shape for ServerEventsContent
  const eventsWithStatus = rawEvents.map((e) => {
    const uiStatus: "SUCCESS" | "FAILED" | "DENIED" =
      e.status === "SUCCESS" ? "SUCCESS" :
      e.status === "FAILED" ? "FAILED" :
      "DENIED"; // INVALID → DENIED for UI compat
    const severity = e.status === "SUCCESS" ? "INFO" : e.status === "FAILED" ? "WARN" : "ERROR";
    return {
      id: e.id,
      eventType: "log.line",
      severity,
      source: `ssh:${e.username}@${e.sourceIp}`,
      message: e.raw ?? `${e.status} for ${e.username} from ${e.sourceIp}`,
      rawData: {
        username: e.username,
        ip: e.sourceIp,
        status: e.status,
        method: e.method,
      },
      eventTime: e.eventTime,
      count: e.count,
      agent: e.agent,
      status: uiStatus,
    };
  });

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

  // Serialize for client component — Date → ISO string
  // Agent can be null (asset-side events have no agent), so coalesce to a placeholder.
  const initialData: ServerEventsData = {
    events: events.map((e) => ({
      ...e,
      eventTime: e.eventTime.toISOString(),
      rawData: e.rawData as any,
      agent: e.agent ?? { name: "unknown", hostname: null, ip: null },
    })),
    total,
    displayed: events.length,
    filteredTotal: filtered.length,
    statusCounts,
    statusFilter: statusFilter ?? "all",
    range,
    q,
    hideRevoked,
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Server Auth
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            SSH login events, sudo, cron dari /var/log/auth.log &amp; /var/log/secure.
            Syslog, nginx &amp; kernel punya menu masing-masing (Syslog, Apps).
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <Link
            href="/dashboard/server"
            className="text-[var(--muted-foreground)] hover:text-[var(--accent)] transition-colors"
          >
            ← SSH Events
          </Link>
          <Link
            href="/dashboard/database"
            className="text-[var(--muted-foreground)] hover:text-[var(--accent)] transition-colors"
          >
            Database Events →
          </Link>
          <DeleteEventsButton />
        </div>
      </div>

      {/* Body — live search, table-only loading, client-side fetches */}
      <ServerEventsContent initialData={initialData} />
    </div>
  );
}
