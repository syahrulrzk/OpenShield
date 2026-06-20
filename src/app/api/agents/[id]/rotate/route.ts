/**
 * /api/agents/[id]/rotate — rotate agent's secret token
 *
 * POST /api/agents/[id]/rotate
 *
 * Generates a NEW secret token, replacing the old one. The old token
 * stops working immediately. The new token is returned ONCE — admin
 * must update the agent's config file with the new credentials.
 *
 * Use case:
 *   - Agent's local state lost (config file deleted, server reinstalled)
 *   - Suspected token compromise (revoke + rotate)
 *   - Periodic key rotation (best practice)
 *
 * Auth: OWNER/ADMIN session required.
 *
 * OWASP A07:2021 — token rotation invalidates old credentials
 */

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/security/crypto";
import { requireRole } from "@/lib/security/rbac";
import { audit } from "@/lib/security/audit";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireRole("OWNER", "ADMIN");
  if (session instanceof NextResponse) return session;
  const userId = session.userId;

  const { id } = await params;
  const agent = await prisma.agent.findUnique({
    where: { id },
    select: { id: true, name: true, type: true, status: true },
  });
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  // Generate fresh token
  const newToken = "os_agt_" + randomBytes(29).toString("hex");
  const newTokenEnc = encrypt(newToken);

  // Replace + reactivate (in case it was REVOKED before)
  const updated = await prisma.agent.update({
    where: { id },
    data: {
      secretEnc: newTokenEnc,
      status: "REGISTERED", // back to REGISTERED until next heartbeat
      revokedAt: null,
      lastError: null,
      lastHeartbeat: null, // force fresh identity report
    },
    select: { id: true, name: true, type: true, status: true },
  });

  await audit({
    userId,
    action: "agent.token.rotated",
    resourceType: "agent",
    resourceId: id,
    metadata: {
      name: agent.name,
      type: agent.type,
      previousStatus: agent.status,
      // Token prefix for audit trail only
      newTokenPrefix: newToken.slice(0, 12),
    },
  });

  return NextResponse.json({
    ok: true,
    agent: updated,
    credentials: {
      agentId: id,
      secretToken: newToken,
      serverUrl: process.env.OPENSHIELD_PUBLIC_URL || process.env.OPENSHIELD_BASE_URL || "http://YOUR-SERVER:3001",
    },
    warning:
      "Old token is now INVALID. Update the agent's config file with the new credentials — shown ONCE.",
  });
}
