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
    include: { _count: { select: { events: true } } },
  });
  if (!agent) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const hard = new URL(req.url).searchParams.get("hard") === "1";

  if (hard) {
    // Hard delete — remove row + cascade events. Audit snapshot kept as JSON in metadata.
    const eventCount = agent._count.events;
    await prisma.agentEvent.deleteMany({ where: { agentId: id } });
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
  if (body.config !== undefined) data.config = body.config;
  if (body.reactivate) {
    data.status = "REGISTERED";
    data.revokedAt = null;
    data.lastError = null;
  }
  if (body.ip !== undefined) {
    data.ip = body.ip;
    data.lastError = null; // clear stale error from old IP mismatch
  }

  const updated = await prisma.agent.update({ where: { id }, data });

  await audit({
    userId,
    action: body.reactivate ? "agent.reactivated" : "agent.updated",
    resourceType: "agent",
    resourceId: id,
    metadata: { fields: Object.keys(data), ipChanged: body.ip !== undefined },
  });

  return NextResponse.json({ ok: true, agent: updated });
}
