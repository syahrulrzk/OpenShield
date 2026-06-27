/**
 * /api/agents/[id] — revoke, hard-delete, or re-activate a registered agent
 *
 * DELETE ?hard=1   — hard delete (permanently remove row + cascade events)
 * DELETE           — soft revoke (status=REVOKED, revokedAt=now, audit preserved)
 * PATCH            — re-activate (status=REGISTERED, revokedAt=null) for re-registration
 *                    OR update config (which logs to watch, etc.)
 *
 * Auth: standard session (admin/owner only)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/security/rbac";
import { audit } from "@/lib/security/audit";

const patchSchema = z.object({
  config: z.any().optional(),
  reactivate: z.boolean().optional(),
  // Admin override: rewrite the agent's reported IP. Useful when an agent
  // is stuck behind a NAT/proxy and reports its public IP instead of the
  // LAN IP, or after a network migration. The agent will keep reporting
  // its own detected IP on the next heartbeat (overwriting this) until it
  // is restarted, so use this as a stop-gap or paired with a restart.
  ip: z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/, "must be a valid IPv4").optional(),
  // Edit display name (cosmetic — for dashboard readability).
  // Useful when agent was auto-named from hostname but admin wants a
  // friendly alias like "db-prod-primary" instead of "ip-10-1-1-50".
  // Trim + non-empty enforced; 64 char ceiling matches schema.
  name: z.string().trim().min(1, "name cannot be empty").max(64, "name too long (max 64 chars)").optional(),
  // Reclassify environment (PROD/STAGING/UAT). Useful when an agent
  // was created before its true env was known, or after a server is
  // promoted/demoted. Matches the Environment enum in prisma/schema.prisma.
  environment: z.enum(["PROD", "STAGING", "UAT"]).optional(),
  // Feature toggles
  enableSyslog: z.boolean().optional(),
  enableSshAuth: z.boolean().optional(),
  enableFim: z.boolean().optional(),
  enableAuditd: z.boolean().optional(),
  enableProcessMon: z.boolean().optional(),
  enableNetwork: z.boolean().optional(),
});

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireRole("OWNER", "ADMIN");
  if (session instanceof NextResponse) return session;
  const userId = session.userId;

  const { id } = await params;
  const agent = await prisma.agent.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          syslogEvents: true,
          serverAuthEvents: true,
          fimEvents: true,
          auditdEvents: true,
          appEvents: true,
        },
      },
    },
  });
  if (!agent) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const hard = new URL(req.url).searchParams.get("hard") === "1";

  if (hard) {
    // Hard delete — remove row + cascade events. Audit snapshot kept as JSON in metadata.
    const eventCount =
      agent._count.syslogEvents +
      agent._count.serverAuthEvents +
      agent._count.fimEvents +
      agent._count.auditdEvents +
      agent._count.appEvents;
    // 2026-06-21 refactor: events span 5 per-type tables (agent-side only;
    // database events live on Asset, not Agent — handled by Asset cascade).
    await Promise.all([
      prisma.tEventLogSyslog.deleteMany({ where: { agentId: id } }),
      prisma.tEventLogServerAuth.deleteMany({ where: { agentId: id } }),
      prisma.tEventLogFim.deleteMany({ where: { agentId: id } }),
      prisma.tEventLogAuditd.deleteMany({ where: { agentId: id } }),
      prisma.tEventLogAgentApps.deleteMany({ where: { agentId: id } }),
    ]);
    await prisma.agent.delete({ where: { id } });

    await audit({
      userId,
      action: "agent.deleted",
      resourceType: "agent",
      resourceId: id,
      metadata: {
        name: agent.name,
        hostname: agent.hostname,
        type: agent.type,
        eventsDeleted: eventCount,
        snapshot: {
          name: agent.name,
          hostname: agent.hostname,
          ip: agent.ip,
          type: agent.type,
          status: agent.status,
          registeredAt: agent.registeredAt,
          revokedAt: agent.revokedAt,
        },
      },
    });

    return NextResponse.json({ ok: true, hard: true, eventsDeleted: eventCount });
  }

  // Soft revoke
  const updated = await prisma.agent.update({
    where: { id },
    data: {
      status: "REVOKED",
      revokedAt: new Date(),
      lastError: "Revoked by admin",
    },
  });

  await audit({
    userId,
    action: "agent.revoked",
    resourceType: "agent",
    resourceId: id,
    metadata: { hostname: agent.hostname, type: agent.type },
  });

  return NextResponse.json({ ok: true, agent: updated });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireRole("OWNER", "ADMIN");
  if (session instanceof NextResponse) return session;
  const userId = session.userId;

  const { id } = await params;
  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "Invalid body", details: String(err) },
      { status: 400 }
    );
  }

  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const data: Record<string, unknown> = {};
  // Track what changed for the audit log — capture before/after so
  // we can see exactly what the admin edited (and roll back mentally).
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  if (body.config !== undefined) data.config = body.config;
  if (body.reactivate) {
    data.status = "REGISTERED";
    data.revokedAt = null;
    data.lastError = null;
  }
  if (body.ip !== undefined) {
    if (body.ip !== agent.ip) diff.ip = { from: agent.ip, to: body.ip };
    data.ip = body.ip;
    data.lastError = null; // clear stale error from old IP mismatch
  }
  if (body.name !== undefined && body.name !== agent.name) {
    diff.name = { from: agent.name, to: body.name };
    data.name = body.name;
  }
  if (body.environment !== undefined && body.environment !== agent.environment) {
    diff.environment = { from: agent.environment, to: body.environment };
    data.environment = body.environment;
  }
  // Feature toggles
  if (body.enableSyslog !== undefined && body.enableSyslog !== agent.enableSyslog) {
    diff.enableSyslog = { from: agent.enableSyslog, to: body.enableSyslog };
    data.enableSyslog = body.enableSyslog;
  }
  if (body.enableSshAuth !== undefined && body.enableSshAuth !== agent.enableSshAuth) {
    diff.enableSshAuth = { from: agent.enableSshAuth, to: body.enableSshAuth };
    data.enableSshAuth = body.enableSshAuth;
  }
  if (body.enableFim !== undefined && body.enableFim !== agent.enableFim) {
    diff.enableFim = { from: agent.enableFim, to: body.enableFim };
    data.enableFim = body.enableFim;
  }
  if (body.enableAuditd !== undefined && body.enableAuditd !== agent.enableAuditd) {
    diff.enableAuditd = { from: agent.enableAuditd, to: body.enableAuditd };
    data.enableAuditd = body.enableAuditd;
  }
  if (body.enableProcessMon !== undefined && body.enableProcessMon !== agent.enableProcessMon) {
    diff.enableProcessMon = { from: agent.enableProcessMon, to: body.enableProcessMon };
    data.enableProcessMon = body.enableProcessMon;
  }
  if (body.enableNetwork !== undefined && body.enableNetwork !== agent.enableNetwork) {
    diff.enableNetwork = { from: agent.enableNetwork, to: body.enableNetwork };
    data.enableNetwork = body.enableNetwork;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: true, agent, unchanged: true });
  }

  const updated = await prisma.agent.update({ where: { id }, data });

  await audit({
    userId,
    action: body.reactivate ? "agent.reactivated" : "agent.updated",
    resourceType: "agent",
    resourceId: id,
    metadata: {
      fields: Object.keys(data),
      ipChanged: body.ip !== undefined,
      diff,
    },
  });

  return NextResponse.json({ ok: true, agent: updated });
}
