// Event Log Router — routes agent events to the correct per-type table
// 2026-06-21: Refactored from single agent_events table to 6 specialized tables
// See: t_event_log_syslog, t_event_log_server_auth, t_event_log_fim,
//      t_event_log_auditd, t_event_log_apps, t_event_log_database
//
// Why a router (not 6 separate API routes):
//   - Agent sends a single batch of mixed events
//   - Each event has rawData.parser that identifies its type
//   - Router maps parser → table and routes accordingly
//   - Dedup logic is per-table (different dedup keys per type)

import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export type IncomingEvent = {
  eventType: string;
  severity: string;
  source: string;
  message: string;
  rawData?: Record<string, unknown>;
  eventTime: string; // ISO-8601
};

export type EventLogType =
  | "syslog"
  | "server_auth"
  | "fim"
  | "auditd"
  | "apps"
  | "database";

/**
 * Map a rawData.parser string to the target event log table.
 * Returns null if the parser is unknown (caller should skip/log error).
 */
export function routeEventByParser(
  rawData: Record<string, unknown> | undefined
): EventLogType | null {
  if (!rawData || typeof rawData !== "object") return null;
  const parser = typeof rawData.parser === "string" ? rawData.parser : null;
  if (!parser) return null;
  switch (parser) {
    case "syslog":
      return "syslog";
    case "sshd":
      return "server_auth";
    case "fim":
      return "fim";
    case "auditd":
      return "auditd";
    case "mysql_audit":
    case "pg_audit":
    case "redis_audit":
    case "nginx_audit":
    case "apache_audit":
      return "apps";
    default:
      return null;
  }
}

/**
 * Route a single incoming event to the correct table.
 * Returns "inserted" | "deduped" | "skipped" with stats.
 */
export async function insertOrDedupEvent(
  agentId: string,
  e: IncomingEvent
): Promise<"inserted" | "deduped" | "skipped"> {
  const target = routeEventByParser(e.rawData);
  if (!target) {
    // Unknown parser — skip silently (could log to stderr for debugging)
    return "skipped";
  }

  // Compute dedup signature (shared logic, see heartbeat/route.ts extractDedupKey)
  const dedupUser = extractDedupKey(e.rawData, e.message);
  const eventKind =
    e.rawData && typeof e.rawData === "object" && "event" in e.rawData
      ? String((e.rawData as Record<string, unknown>).event ?? "")
      : "";
  const dedupSig = `${dedupUser}|${e.source}|${e.severity}|${eventKind}`;

  const eventTime = new Date(e.eventTime);
  const dedupStart = new Date(eventTime.getTime() - DEDUP_WINDOW_MS);

  switch (target) {
    case "syslog":
      return await insertSyslogEvent(agentId, e, dedupSig, eventTime, dedupStart);
    case "server_auth":
      return await insertServerAuthEvent(agentId, e, dedupSig, eventTime, dedupStart);
    case "fim":
      return await insertFimEvent(agentId, e, dedupSig, eventTime, dedupStart);
    case "auditd":
      return await insertAuditdEvent(agentId, e, dedupSig, eventTime, dedupStart);
    case "apps":
      return await insertAppEvent(agentId, e, dedupSig, eventTime, dedupStart);
    case "database":
      // Database events come from poller-side, not agent. Skip if received here.
      return "skipped";
    default:
      return "skipped";
  }
}

// Dedup window: 5 minutes
const DEDUP_WINDOW_MS = 5 * 60 * 1000;

/**
 * Extract dedup key from rawData + message.
 * Mirrors logic in heartbeat/route.ts. For syslog events (no user/ip),
 * uses process + truncated message to avoid collapsing all same-source
 * events into one row.
 */
function extractDedupKey(
  rawData: Record<string, unknown> | undefined,
  message: string
): string {
  let user: string | null = null;
  let ip: string | null = null;
  if (rawData && typeof rawData === "object") {
    if (typeof rawData.user === "string") user = rawData.user;
    if (typeof rawData.username === "string") user = rawData.username;
    if (typeof rawData.ip === "string") ip = rawData.ip;
    if (typeof rawData.sourceIp === "string") ip = rawData.sourceIp;
  }
  if (!user) {
    const m = message.match(/\b(?:for|user=)\s+([a-zA-Z0-9._\-]+)/);
    if (m) user = m[1];
  }
  if (!ip) {
    const m = message.match(/\bfrom\s+((?:\d{1,3}\.){3}\d{1,3}|[0-9a-fA-F:]+)\b/);
    if (m) ip = m[1];
  }
  // For events without user/ip (syslog-style), use process + truncated
  // message as the dedup identity. See comment in heartbeat/route.ts.
  if (!user && !ip && rawData && typeof rawData === "object") {
    if (typeof rawData.process === "string" && rawData.process.length > 0) {
      const proc = rawData.process;
      const fullMsg = typeof rawData.full_message === "string"
        ? rawData.full_message
        : (typeof message === "string" ? message : "");
      const msgFp = fullMsg.slice(0, 80).replace(/\s+/g, "_");
      user = `${proc}|${msgFp}`;
    }
  }
  // For connection-class events (sshd.connection), include client source
  // port in the dedup sig — same IP can open many parallel SSH sessions
  // each with their own ephemeral port. Without port, two unrelated
  // connections from same IP within dedup window would falsely merge.
  let portSuffix = "";
  if (rawData && typeof rawData === "object") {
    const evtType = typeof rawData.event === "string" ? rawData.event : "";
    if (evtType === "sshd.connection") {
      const p = rawData.port ?? rawData.clientPort;
      if (typeof p === "number" || typeof p === "string") {
        portSuffix = `:${p}`;
      }
    }
  }
  return `${user || "_unknown"}|${ip || "_unknown"}${portSuffix}`;
}

// ----- Per-type insert functions -----

async function insertSyslogEvent(
  agentId: string,
  e: IncomingEvent,
  dedupSig: string,
  eventTime: Date,
  dedupStart: Date
): Promise<"inserted" | "deduped"> {
  const rawData = e.rawData as Record<string, unknown> | undefined;
  const process = typeof rawData?.process === "string" ? rawData.process : null;
  const hostname = typeof rawData?.hostname === "string" ? rawData.hostname : null;
  const pid = typeof rawData?.pid === "number" ? rawData.pid :
              typeof rawData?.pid === "string" && /^\d+$/.test(rawData.pid) ? parseInt(rawData.pid, 10) : null;

  const existing = await prisma.tEventLogSyslog.findFirst({
    where: {
      agentId,
      source: e.source,
      severity: e.severity,
      rawData: { path: ["_dedupSig"], equals: dedupSig },
      eventTime: { gte: dedupStart },
    },
    select: { id: true },
  });
  if (existing) {
    await prisma.tEventLogSyslog.update({
      where: { id: existing.id },
      data: {
        count: { increment: 1 },
        eventTime,
        message: e.message,
        rawData: { ...(rawData || {}), _dedupSig: dedupSig } as Prisma.InputJsonValue,
      },
    });
    return "deduped";
  }
  await prisma.tEventLogSyslog.create({
    data: {
      agentId,
      severity: e.severity,
      source: e.source,
      process,
      pid,
      hostname,
      message: e.message,
      rawData: { ...(rawData || {}), _dedupSig: dedupSig } as Prisma.InputJsonValue,
      eventTime,
      count: 1,
    },
  });
  return "inserted";
}

async function insertServerAuthEvent(
  agentId: string,
  e: IncomingEvent,
  dedupSig: string,
  eventTime: Date,
  dedupStart: Date
): Promise<"inserted" | "deduped"> {
  const rawData = e.rawData as Record<string, unknown> | undefined;
  const username = typeof rawData?.user === "string" ? rawData.user :
                   typeof rawData?.username === "string" ? rawData.username : "_unknown";
  const sourceIp = typeof rawData?.ip === "string" ? rawData.ip :
                   typeof rawData?.sourceIp === "string" ? rawData.sourceIp : "_unknown";
  // Map event type to ServerStatus enum
  const event = typeof rawData?.event === "string" ? rawData.event : "";
  const status: "SUCCESS" | "FAILED" | "INVALID" =
    event === "sshd.failed_password" || event === "sshd.failed_publickey" ? "FAILED" :
    event === "sshd.invalid_user" ? "INVALID" :
    "SUCCESS";
  const method = typeof rawData?.method === "string" ? rawData.method : null;

  // Dedup by (username + sourceIp + status + method). t_event_log_server_auth
  // has structured columns (no rawData JSONB) so we filter on the
  // canonical fields, then verify dedupSig matches via raw column.
  const existing = await prisma.tEventLogServerAuth.findFirst({
    where: {
      agentId,
      sourceIp,
      status,
      method,
      username,
      eventTime: { gte: dedupStart },
    },
    select: { id: true, raw: true, count: true },
  });
  // Only dedup if raw line contains the same dedupSig (to avoid false merges
  // across distinct sub-events)
  if (existing && existing.raw?.includes(dedupSig)) {
    await prisma.tEventLogServerAuth.update({
      where: { id: existing.id },
      data: {
        count: { increment: 1 },
        eventTime,
      },
    });
    return "deduped";
  }
  await prisma.tEventLogServerAuth.create({
    data: {
      agentId,
      username,
      sourceIp,
      status,
      method,
      raw: e.message + " | sig=" + dedupSig,
      eventTime,
      count: 1,
    },
  });
  return "inserted";
}

async function insertFimEvent(
  agentId: string,
  e: IncomingEvent,
  dedupSig: string,
  eventTime: Date,
  dedupStart: Date
): Promise<"inserted" | "deduped"> {
  const rawData = e.rawData as Record<string, unknown> | undefined;
  const action = typeof rawData?.action === "string" ? rawData.action : "MODIFIED";
  const path = typeof rawData?.path === "string" ? rawData.path : e.source;

  const existing = await prisma.tEventLogFim.findFirst({
    where: {
      agentId,
      path,
      action,
      rawData: { path: ["_dedupSig"], equals: dedupSig },
      eventTime: { gte: dedupStart },
    },
    select: { id: true },
  });
  if (existing) {
    await prisma.tEventLogFim.update({
      where: { id: existing.id },
      data: {
        count: { increment: 1 },
        eventTime,
        message: e.message,
        rawData: { ...(rawData || {}), _dedupSig: dedupSig } as Prisma.InputJsonValue,
      },
    });
    return "deduped";
  }
  await prisma.tEventLogFim.create({
    data: {
      agentId,
      action,
      path,
      oldHash: typeof rawData?.oldHash === "string" ? rawData.oldHash : null,
      newHash: typeof rawData?.newHash === "string" ? rawData.newHash : null,
      size: typeof rawData?.size === "number" ? BigInt(rawData.size) : null,
      mode: typeof rawData?.mode === "string" ? rawData.mode : null,
      owner: typeof rawData?.owner === "string" ? rawData.owner : null,
      message: e.message,
      rawData: { ...(rawData || {}), _dedupSig: dedupSig } as Prisma.InputJsonValue,
      eventTime,
      count: 1,
    },
  });
  return "inserted";
}

async function insertAuditdEvent(
  agentId: string,
  e: IncomingEvent,
  dedupSig: string,
  eventTime: Date,
  dedupStart: Date
): Promise<"inserted" | "deduped"> {
  const rawData = e.rawData as Record<string, unknown> | undefined;
  const eventType = typeof rawData?.auditdType === "string" ? rawData.auditdType : e.eventType;

  const existing = await prisma.tEventLogAuditd.findFirst({
    where: {
      agentId,
      eventType,
      rawData: { path: ["_dedupSig"], equals: dedupSig },
      eventTime: { gte: dedupStart },
    },
    select: { id: true },
  });
  if (existing) {
    await prisma.tEventLogAuditd.update({
      where: { id: existing.id },
      data: {
        count: { increment: 1 },
        eventTime,
        rawData: { ...(rawData || {}), _dedupSig: dedupSig } as Prisma.InputJsonValue,
      },
    });
    return "deduped";
  }
  await prisma.tEventLogAuditd.create({
    data: {
      agentId,
      severity: e.severity,
      eventType,
      typeCode: typeof rawData?.typeCode === "number" ? rawData.typeCode : null,
      process: typeof rawData?.process === "string" ? rawData.process : null,
      pid: typeof rawData?.pid === "number" ? rawData.pid : null,
      uid: typeof rawData?.uid === "string" ? rawData.uid : null,
      euid: typeof rawData?.euid === "string" ? rawData.euid : null,
      message: e.message,
      rawData: { ...(rawData || {}), _dedupSig: dedupSig } as Prisma.InputJsonValue,
      eventTime,
      count: 1,
    },
  });
  return "inserted";
}

async function insertAppEvent(
  agentId: string,
  e: IncomingEvent,
  dedupSig: string,
  eventTime: Date,
  dedupStart: Date
): Promise<"inserted" | "deduped"> {
  const rawData = e.rawData as Record<string, unknown> | undefined;
  // app_name from rawData.service lowercased
  const service = typeof rawData?.service === "string" ? rawData.service : "unknown";
  const appName = service.toLowerCase();
  // event from rawData.event (e.g. "mysql.connect.success")
  const event = typeof rawData?.event === "string" ? rawData.event : "log.line";
  const username = typeof rawData?.username === "string" ? rawData.username : null;
  const sourceIp = typeof rawData?.ip === "string" && rawData.ip !== "localhost" ? rawData.ip : null;
  const database = typeof rawData?.database === "string" ? rawData.database : null;

  const existing = await prisma.tEventLogApps.findFirst({
    where: {
      agentId,
      appName,
      event,
      rawData: { path: ["_dedupSig"], equals: dedupSig },
      eventTime: { gte: dedupStart },
    },
    select: { id: true },
  });
  if (existing) {
    await prisma.tEventLogApps.update({
      where: { id: existing.id },
      data: {
        count: { increment: 1 },
        eventTime,
        message: e.message,
        rawData: { ...(rawData || {}), _dedupSig: dedupSig } as Prisma.InputJsonValue,
      },
    });
    return "deduped";
  }
  await prisma.tEventLogApps.create({
    data: {
      agentId,
      appName,
      event,
      severity: e.severity,
      username,
      sourceIp,
      database,
      message: e.message,
      rawData: { ...(rawData || {}), _dedupSig: dedupSig } as Prisma.InputJsonValue,
      eventTime,
      count: 1,
    },
  });
  return "inserted";
}
