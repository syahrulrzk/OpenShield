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

const agentEventSchema = z.object({
  eventType: z.enum([
    "log.line",
    "file.change",
    "process.new",
    "metric.system",
    "custom",
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

const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 min

/**
 * Extract a stable dedup signature from rawData + message so that two
 * events with different user/IP/method don't aggregate together.
 * Examples:
 *   "Failed password for gm from 1.2.3.4" → "gm|1.2.3.4"
 *   "SSH login OK (publickey) for linux from 10.1.1.100" → "linux|10.1.1.100"
 *   "sudo: COMMAND=apt update by root" → "root"
 */
function extractDedupKey(
  rawData: unknown,
  message: string
): string {
  let user: string | null = null;
  let ip: string | null = null;
  if (rawData && typeof rawData === "object" && !Array.isArray(rawData)) {
    const rd = rawData as Record<string, unknown>;
    const u = rd.user ?? rd.username ?? rd.account ?? rd.subject;
    if (typeof u === "string" && u.length > 0) user = u;
    if (typeof rd.ip === "string" && rd.ip.length > 0 && rd.ip !== "0.0.0.0") {
      ip = rd.ip;
    }
  }
  if (!user) {
    // Fallback: regex from message
    const m = message.match(/\b(?:for|user=)\s+([a-zA-Z0-9._\-]+)/i);
    if (m) user = m[1];
  }
  if (!ip) {
    const m = message.match(/\bfrom\s+((?:\d{1,3}\.){3}\d{1,3}|[0-9a-fA-F:]+)\b/);
    if (m) ip = m[1];
  }
  // For connection-class events (sshd.connection), the client source port
  // is part of the unique identity — same IP can open many parallel SSH
  // sessions, each with its own ephemeral port. Without including port,
  // two unrelated connections from the same IP within the dedup window
  // would falsely merge into one row.
  let portSuffix = "";
  if (rawData && typeof rawData === "object" && !Array.isArray(rawData)) {
    const rd = rawData as Record<string, unknown>;
    const evtType = typeof rd.event === "string" ? rd.event : "";
    if (evtType === "sshd.connection") {
      const p = rd.port ?? rd.clientPort;
      if (typeof p === "number" || typeof p === "string") {
        portSuffix = `:${p}`;
      }
    }
  }
  return `${user ?? "_unknown"}|${ip ?? "_unknown"}${portSuffix}`;
}

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

  // 3. Insert events (with dedup-with-aggregation like ServerEvent)
  if (body.events?.length) {
    for (const e of body.events) {
      const eventTime = new Date(e.eventTime);
      const dedupStart = new Date(eventTime.getTime() - DEDUP_WINDOW_MS);
      // Extract dedup signature from message + rawData so events with
      // DIFFERENT users/IPs/methods don't aggregate together. Without this,
      // "Failed password for testuser" + "Failed password for gm" + "Failed
      // password for hacker20" (all same source/severity/5min) would merge
      // into one row, leaving rawData stale while message updates → confusing
      // "user: testuser, message: ...for gm" UI mismatch.
      const dedupUser = extractDedupKey(e.rawData, e.message);
      const dedupSig = `${dedupUser}|${e.source}|${e.severity}`;
      try {
        const existing = await prisma.agentEvent.findFirst({
          where: {
            agentId,
            eventType: e.eventType,
            // Dedup by (user, source, severity, time-window) — not just source.
            // Two events dedupe only if they represent the SAME auth attempt
            // pattern from the SAME user/source.
            rawData: {
              path: ["_dedupSig"],
              equals: dedupSig,
            },
            eventTime: { gte: dedupStart },
          },
          select: { id: true },
        });
        if (existing) {
          await prisma.agentEvent.update({
            where: { id: existing.id },
            data: {
              count: { increment: 1 },
              eventTime,
              message: e.message,
              rawData: e.rawData
                ? { ...(e.rawData as Record<string, unknown>), _dedupSig: dedupSig }
                : { _dedupSig: dedupSig },
            },
          });
          stats.eventsDeduped++;
        } else {
          await prisma.agentEvent.create({
            data: {
              agentId,
              eventType: e.eventType,
              severity: e.severity,
              source: e.source,
              message: e.message,
              rawData: e.rawData
                ? { ...(e.rawData as Record<string, unknown>), _dedupSig: dedupSig }
                : { _dedupSig: dedupSig },
              eventTime,
              count: 1,
            },
          });
          stats.eventsInserted++;
        }
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
