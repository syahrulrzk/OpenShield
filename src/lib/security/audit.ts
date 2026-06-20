/**
 * OpenShield — Audit Log (append-only, hash-chained)
 *
 * OWASP A09:2021 — Security Logging & Monitoring Failures
 * OWASP A08:2021 — Software & Data Integrity (hash chain = tamper detection)
 *
 * Every state-changing action is logged with:
 * - user, action, resource, IP, user agent, metadata
 * - hash chain: each row's hash = SHA-256(prevHash || canonical(row))
 * - Verification: walk the chain, recompute hash, compare
 */

import { prisma } from "@/lib/db";
import { createHash } from "node:crypto";

export type AuditAction =
  | "auth.login.success"
  | "auth.login.failed"
  | "auth.logout"
  | "auth.register"
  | "asset.create"
  | "asset.update"
  | "asset.delete"
  | "asset.test_connection"
  | "credential.create"
  | "credential.view"
  | "credential.update"
  | "credential.delete"
  | "alert.create"
  | "alert.resolve"
  | "user.create"
  | "user.update"
  | "user.delete"
  | "settings.update"
  | "mock.generate"
  | "mock.clear"
  | "ingest.accepted"
  | "ingest.rejected"
  | "poller.run"
  | "poller.error"
  | "agent.created"
  | "agent.register.created"
  | "agent.register.rotated"
  | "agent.register.rejected"
  | "agent.heartbeat.rejected"
  | "agent.revoked"
  | "agent.reactivated"
  | "agent.updated"
  | "agent.token.rotated"
  | "agent.bundle.downloaded"
  | "agent.deleted"
  | "agent.install_script.generated"
  | "events.deleted";

export type AuditInput = {
  userId?: string | null;
  action: AuditAction;
  resourceType?: string;
  resourceId?: string;
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
};

function canonical(row: Omit<AuditInput, never> & { ts: string }): string {
  // Stable canonical form (sorted keys) for hash reproducibility
  const obj = {
    userId: row.userId ?? null,
    action: row.action,
    resourceType: row.resourceType ?? null,
    resourceId: row.resourceId ?? null,
    ip: row.ip ?? null,
    userAgent: row.userAgent ?? null,
    metadata: row.metadata ?? null,
    ts: row.ts,
  };
  return JSON.stringify(obj, Object.keys(obj).sort());
}

function hashRow(prevHash: string | null, row: Omit<AuditInput, never> & { ts: string }): string {
  return createHash("sha256")
    .update((prevHash ?? "GENESIS") + "|" + canonical(row))
    .digest("hex");
}

export async function audit(input: AuditInput): Promise<void> {
  const ts = new Date();
  // Fetch the latest hash (could be a perf bottleneck under load; for MVP, OK)
  const last = await prisma.auditLog.findFirst({
    orderBy: { createdAt: "desc" },
    select: { hash: true },
  });
  const prevHash = last?.hash ?? null;
  const row = { ...input, ts: ts.toISOString() };
  const hash = hashRow(prevHash, row);
  try {
    await prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        ip: input.ip,
        userAgent: input.userAgent,
        metadata: input.metadata as any,
        prevHash,
        hash,
        createdAt: ts,
      },
    });
  } catch (err) {
    // Audit must not break user flow, but log loudly
    console.error("[AUDIT FAILED]", err, input);
  }
}

/** Verify the hash chain integrity. Returns the index of the first broken row, or null if valid. */
export async function verifyAuditChain(): Promise<{ valid: true } | { valid: false; brokenAt: string }> {
  const rows = await prisma.auditLog.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, userId: true, action: true, resourceType: true, resourceId: true, ip: true, userAgent: true, metadata: true, createdAt: true, prevHash: true, hash: true },
  });
  let prev: string | null = null;
  for (const r of rows) {
    const expected = hashRow(prev, {
      userId: r.userId,
      action: r.action as AuditAction,
      resourceType: r.resourceType ?? undefined,
      resourceId: r.resourceId ?? undefined,
      ip: r.ip ?? undefined,
      userAgent: r.userAgent ?? undefined,
      metadata: (r.metadata as Record<string, unknown> | null) ?? undefined,
      ts: r.createdAt.toISOString(),
    });
    if (expected !== r.hash || r.prevHash !== prev) {
      return { valid: false, brokenAt: r.id };
    }
    prev = r.hash;
  }
  return { valid: true };
}
