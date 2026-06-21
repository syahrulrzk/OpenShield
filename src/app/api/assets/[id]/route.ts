/**
 * /api/assets/[id] — Single Asset CRUD
 *
 * PATCH /api/assets/[id]
 *   Body: { displayName?, environment?, role?, location?, description?, tags? }
 *   - Owner-only: displayName uniqueness re-checked
 *   - Audit log: asset.update with diff (old vs new for changed fields)
 *
 * DELETE /api/assets/[id]
 *   Body: { confirm: true }  — required to prevent accidental delete
 *   - Cascades: deletes AssetCredential (via Prisma onDelete: Cascade)
 *   - DbEvents are NOT deleted (history preserved), but assetId set NULL
 *   - Audit log: asset.delete with displayName, hostname, env
 *
 * Auth: OWNER or ADMIN
 *
 * SECURITY:
 *   - Re-validates userId on every request (assets are user-scoped)
 *   - Never returns dbEncData (sensitive)
 *   - Delete requires explicit "confirm: true" body field
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/security/rbac";
import { audit } from "@/lib/security/audit";

const patchSchema = z.object({
  displayName: z.string().trim().min(1).max(64).optional(),
  environment: z.enum(["PROD", "STAGING", "UAT"]).optional(),
  role: z.string().trim().max(64).nullable().optional(),
  location: z.string().trim().max(128).nullable().optional(),
  description: z.string().trim().max(512).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(16).optional(),
  // Opsi B: toggle multi-DB scan mode
  monitorAllDatabases: z.boolean().optional(),
  // MySQL connection audit log (general_log table mode)
  // Poller will pick up change on next cycle. No state reset needed —
  // lastAuditEventId cursor stays valid (we read NEWER events only).
  auditConnectionLog: z.boolean().optional(),
});

const deleteSchema = z.object({
  confirm: z.literal(true),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth();
  if (session instanceof NextResponse) return session;
  if (session.role !== "OWNER" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const data = parsed.data;

  // Find existing (scoped to user)
  const existing = await prisma.asset.findFirst({
    where: { id, userId: session.userId },
    select: {
      id: true,
      displayName: true,
      environment: true,
      role: true,
      location: true,
      description: true,
      tags: true,
      monitorAllDatabases: true,
      auditConnectionLog: true,
      dbType: true,
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  // If displayName changing, re-check uniqueness
  if (data.displayName && data.displayName !== existing.displayName) {
    const dup = await prisma.asset.findFirst({
      where: { userId: session.userId, displayName: data.displayName, NOT: { id } },
      select: { id: true },
    });
    if (dup) {
      return NextResponse.json(
        { error: `Asset displayName "${data.displayName}" already exists` },
        { status: 409 }
      );
    }
  }

  // Build diff for audit
  const diff: Record<string, { old: unknown; new: unknown }> = {};
  for (const k of [
    "displayName",
    "environment",
    "role",
    "location",
    "description",
    "tags",
    "monitorAllDatabases",
    "auditConnectionLog",
  ] as const) {
    if (k in data) {
      const oldV = (existing as Record<string, unknown>)[k];
      const newV = data[k];
      if (JSON.stringify(oldV) !== JSON.stringify(newV)) {
        diff[k] = { old: oldV, new: newV };
      }
    }
  }

  // Apply
  // If toggling monitorAllDatabases, reset discovery cache so poller
  // re-discovers on next cycle with new mode
  const updateData: Record<string, unknown> = { ...data };
  if ("monitorAllDatabases" in data) {
    updateData.discoveredDatabases = null;
    updateData.lastDiscoveryAt = null;
  }
  const updated = await prisma.asset.update({
    where: { id },
    data: updateData,
    select: {
      id: true,
      displayName: true,
      environment: true,
      role: true,
      location: true,
      description: true,
      tags: true,
      status: true,
      monitorAllDatabases: true,
      discoveredDatabases: true,
      auditConnectionLog: true,
    },
  });

  // Audit (only if there were changes)
  if (Object.keys(diff).length > 0) {
    await audit({
      userId: session.userId,
      action: "asset.update",
      resourceType: "asset",
      resourceId: id,
      metadata: { diff, displayName: updated.displayName },
      ip: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
  }

  return NextResponse.json({ ok: true, asset: updated, diff });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth();
  if (session instanceof NextResponse) return session;
  if (session.role !== "OWNER" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  // Parse body (delete requires explicit confirm)
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    // Empty body is allowed for DELETE in some clients, but we require confirm
  }
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Confirmation required",
        details: { confirm: ['Must be true to delete. Send JSON body: { "confirm": true }'] },
      },
      { status: 400 }
    );
  }

  // Find existing
  const existing = await prisma.asset.findFirst({
    where: { id, userId: session.userId },
    select: {
      id: true,
      displayName: true,
      hostname: true,
      environment: true,
      dbType: true,
      dbCredentials: { select: { id: true } },
      _count: { select: { dbEvents: true } },
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  // Delete (cascade will remove AssetCredential per schema)
  await prisma.asset.delete({ where: { id } });

  // Audit
  await audit({
    userId: session.userId,
    action: "asset.delete",
    resourceType: "asset",
    resourceId: id,
    metadata: {
      displayName: existing.displayName,
      hostname: existing.hostname,
      environment: existing.environment,
      dbType: existing.dbType,
      eventsDeleted: 0, // events preserved (set null)
      credentialsDeleted: existing.dbCredentials ? 1 : 0,
    },
    ip: req.headers.get("x-forwarded-for") ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });

  return NextResponse.json({
    ok: true,
    deleted: {
      id,
      displayName: existing.displayName,
      eventsPreserved: existing._count.dbEvents,
      credentialsDeleted: existing.dbCredentials ? 1 : 0,
    },
  });
}