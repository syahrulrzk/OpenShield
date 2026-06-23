/**
 * /api/agents/heartbeat — agent heartbeat + optional event push
 *
 * Agents call this every 30-60s. The endpoint:
 *   1. Verifies HMAC signature using the agent's per-agent secret.
 *   2. Updates agent status (ONLINE/STALE/ERROR) based on last heartbeat.
 *   3. Optionally accepts events in the same payload (so the agent
 *      can piggyback event data on heartbeats — saves a separate POST).
 *   4. Returns the agent's current config (logs to watch, etc.).
 *
 * Headers:
 *   X-Openshield-Agent-Id:        <agent id from /register>
 *   X-Openshield-Agent-Signature: sha256=<hex>
 * Body: {
 *   version: string,
 *   events?: Array<{ eventType, severity, source, message, rawData?, eventTime }>,
 *   stats?: { cpuPct?, memPct?, diskPct? }
 * }
 *
 * Auth: HMAC-SHA256 with per-agent secret (decrypted from DB)
 *
 * OWASP A07:2021 — agent identity verified per-request
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/security/crypto";
import { audit } from "@/lib/security/audit";
import { getVersionStatus } from "@/lib/agent-versions";
import { getAgentCompat } from "@/lib/agent-versions.server";
import { insertOrDedupEvent } from "@/lib/event-log-router";

const agentEventSchema = z.object({
  // 2026-06-22: expanded enum to cover all agent-emitted event types.
  // The SyslogParser was previously forced to 'log.line' by a hardcoded
  // bug in _make_event (overriding the caller's event_type), so the
  // server never saw syslog.* values. Now that the agent respects the
  // param (see agents/python/agent.py SyslogParser._make_event fix),
  // we have to whitelist every category the agent can emit.
  eventType: z.enum([
    "log.line",
    "file.change",
    "process.new",
    "metric.system",
    "custom",
    // ── SyslogParser categories (2026-06-22) ──────────────────────
    "syslog.sshd",
    "syslog.sudo",
    "syslog.su",
    "syslog.pam",
    "syslog.user_change",
    "syslog.privilege",
    "syslog.session",
    "syslog.service.started",
    "syslog.service.failed",
    "syslog.service.stopped",
    "syslog.cron.job",
    "syslog.cron.edit",
    "syslog.cron.scheduled",
    "syslog.network.link",
    "syslog.firewall.blocked",
    "syslog.network.dhcp",
    "syslog.docker.container",
    "syslog.docker.error",
    "syslog.disk.full",
    "syslog.disk.error",
    "syslog.usb.device",
    "syslog.kernel.panic",
    "syslog.kernel.segfault",
    "syslog.hardware.error",
    "syslog.package.install",
    "syslog.boot.started",
    "syslog.boot.lifecycle",
    "syslog.boot.kernel",
    "syslog.boot.shutdown",
    "syslog.bruteforce",
    "syslog.malformed",
    // ── Network syslog (2026-06-23) ─────────────────────────────────────
    // agent.py NetworkSyslogReceiver emits these via parser="network"
    // (cisco|mikrotik|fortinet|generic) × eventKind (link|acl|bgp|auth|
    // config-change|dot1x|dhcp|mac-flap|port-security|routing|other).
    "network.cisco.link",
    "network.cisco.acl",
    "network.cisco.bgp",
    "network.cisco.auth",
    "network.cisco.config-change",
    "network.cisco.dot1x",
    "network.cisco.dhcp",
    "network.cisco.mac-flap",
    "network.cisco.port-security",
    "network.cisco.routing",
    "network.cisco.other",
    "network.mikrotik.link",
    "network.mikrotik.acl",
    "network.mikrotik.bgp",
    "network.mikrotik.auth",
    "network.mikrotik.config-change",
    "network.mikrotik.dhcp",
    "network.mikrotik.routing",
    "network.mikrotik.system",
    "network.mikrotik.other",
    "network.fortinet.link",
    "network.fortinet.acl",
    "network.fortinet.bgp",
    "network.fortinet.auth",
    "network.fortinet.config-change",
    "network.fortinet.other",
    "network.generic.other",
  ]),
  severity: z.enum(["INFO", "WARN", "ERROR", "CRITICAL"]).default("INFO"),
  source: z.string().min(1).max(512),
  message: z.string().min(1).max(2048),
  rawData: z.any().optional(),
  eventTime: z.string().datetime(),
});

const heartbeatSchema = z.object({
  version: z.string().min(1).max(32),
  events: z.array(agentEventSchema).max(500).optional(),
  stats: z
    .object({
      cpuPct: z.number().min(0).max(100).optional(),
      memPct: z.number().min(0).max(100).optional(),
      diskPct: z.number().min(0).max(100).optional(),
      loadAvg: z.number().optional(),
    })
    .optional(),
  // Optional identity block — agents populate hostname/ip/os/kernel here.
  // Used by admin-initiated agents to register their identity on first
  // heartbeat (since admin create flow doesn't have it).
  identity: z
    .object({
      hostname: z.string().max(255).optional(),
      ip: z.string().max(64).optional(),
      os: z.string().max(64).optional(),
      kernel: z.string().max(128).optional(),
    })
    .optional(),
});

async function verifyAgentSignature(
  agentId: string,
  body: string,
  signature: string | null
): Promise<{ ok: boolean; reason?: string; secret?: string }> {
  if (!signature || !signature.startsWith("sha256=")) {
    return { ok: false, reason: "missing_or_malformed_signature" };
  }

  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { id: true, status: true, secretEnc: true, revokedAt: true },
  });
  if (!agent) return { ok: false, reason: "unknown_agent" };
  if (agent.status === "REVOKED" || agent.revokedAt) {
    return { ok: false, reason: "agent_revoked" };
  }
  if (!agent.secretEnc) return { ok: false, reason: "no_secret_on_record" };

  let secret: string;
  try {
    secret = decrypt(agent.secretEnc);
  } catch {
    return { ok: false, reason: "secret_decrypt_failed" };
  }

  const { createHmac, timingSafeEqual } = await import("node:crypto");
  const expected = "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");

  if (signature.length !== expected.length) {
    return { ok: false, reason: "signature_length_mismatch" };
  }
  try {
    const valid = timingSafeEqual(
      Buffer.from(signature, "utf8"),
      Buffer.from(expected, "utf8")
    );
    return valid
      ? { ok: true, secret }
      : { ok: false, reason: "signature_mismatch" };
  } catch {
    return { ok: false, reason: "signature_compare_failed" };
  }
}

export async function POST(req: NextRequest) {
  const agentId = req.headers.get("x-openshield-agent-id");
  const signature = req.headers.get("x-openshield-agent-signature");

  if (!agentId) {
    return NextResponse.json(
      { error: "Missing X-Openshield-Agent-Id header" },
      { status: 401 }
    );
  }

  const rawBody = await req.text();

  // 1. Verify HMAC signature
  const authResult = await verifyAgentSignature(agentId, rawBody, signature);
  if (!authResult.ok) {
    await audit({
      userId: null,
      action: "agent.heartbeat.rejected",
      resourceType: "agent",
      resourceId: agentId,
      metadata: { reason: authResult.reason },
    });
    return NextResponse.json(
      { error: "Auth failed", reason: authResult.reason },
      { status: 401 }
    );
  }

  // 2. Parse body
  let body: z.infer<typeof heartbeatSchema>;
  try {
    body = heartbeatSchema.parse(JSON.parse(rawBody));
  } catch (err) {
    return NextResponse.json(
      { error: "Invalid body", details: String(err) },
      { status: 400 }
    );
  }

  const stats = { eventsInserted: 0, eventsDeduped: 0, errors: 0 };

  // 3. Insert events (routed to per-type tables by event-log-router)
  if (body.events?.length) {
    for (const e of body.events) {
      try {
        const result = await insertOrDedupEvent(agentId, {
          eventType: e.eventType,
          severity: e.severity,
          source: e.source,
          message: e.message,
          rawData: e.rawData as Record<string, unknown> | undefined,
          eventTime: e.eventTime,
        });
        if (result === "inserted") stats.eventsInserted++;
        else if (result === "deduped") stats.eventsDeduped++;
        // 'skipped' = unknown parser; counted in errors
        else stats.errors++;
      } catch (err) {
        stats.errors++;
        console.error("[agent.heartbeat] event insert failed", err);
      }
    }
  }

  // 4. Update agent status + identity (identity only sent on first heartbeat
  //    for admin-initiated agents; updates hostname/IP if they change later)
  const updateData: Record<string, unknown> = {
    lastHeartbeat: new Date(),
    status: "ONLINE",
    lastError: null,
    version: body.version,
    eventsSent: { increment: stats.eventsInserted + stats.eventsDeduped },
  };
  if (body.identity?.hostname) updateData.hostname = body.identity.hostname;
  if (body.identity?.ip) updateData.ip = body.identity.ip;
  if (body.identity?.os) updateData.os = body.identity.os;
  if (body.identity?.kernel) updateData.kernel = body.identity.kernel;

  const agent = await prisma.agent.update({
    where: { id: agentId },
    data: updateData,
    select: { id: true, config: true, hostname: true, ip: true },
  });

  // 5. Return agent config + ACK
  // Default config for new agents (admin can edit later via UI/API)
  const defaultConfig = {
    logs: [
      { path: "/var/log/auth.log", parser: "sshd" },
      { path: "/var/log/syslog", parser: "syslog" },
    ],
    heartbeatIntervalSec: 30,
    eventBatchSize: 100,
  };
  const config = (agent.config as any) ?? defaultConfig;

  return NextResponse.json({
    ok: true,
    agentId,
    status: "ONLINE",
    config,
    stats,
    // Version compatibility info — agent uses this to decide whether
    // to log a "self-update available" hint. Dashboard also reads this.
    versionCompat: (() => {
      const compat = getAgentCompat();
      return {
        agentVersion: body.version,
        minVersion: compat.min,
        latestVersion: compat.latest,
        status: getVersionStatus(body.version, compat),
      };
    })(),
  });
}

/** Health check */
export async function GET() {
  const onlineCount = await prisma.agent.count({
    where: { status: "ONLINE" },
  });
  return NextResponse.json({
    ok: true,
    endpoint: "/api/agents/heartbeat",
    auth: "HMAC-SHA256 per-agent secret (X-Openshield-Agent-Signature)",
    onlineAgents: onlineCount,
  });
}
