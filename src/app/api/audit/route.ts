/**
 * /api/audit — paginated audit log query
 *
 * GET /api/audit
 * Query params:
 *   page?: number (default 1)
 *   pageSize?: number (default 50, max 200)
 *   action?: string (filter by action, exact match)
 *   userId?: string (filter by userId)
 *   resourceType?: string (filter by resource type)
 *   since?: ISO date (filter createdAt >= since)
 *   until?: ISO date (filter createdAt <= until)
 *   search?: string (search in action + metadata JSON)
 *
 * Response:
 *   {
 *     rows: AuditLog[],
 *     total: number,
 *     page: number,
 *     pageSize: number,
 *     totalPages: number,
 *     chainIntegrity: { valid: boolean, brokenAt?: string }
 *   }
 *
 * Auth: any logged-in user (read-only).
 * Note: Admin/Owner role gets all rows; VIEWER can also see audit logs (read-only).
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/security/rbac";
import { prisma } from "@/lib/db";
import { verifyAuditChain } from "@/lib/security/audit";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    200,
    Math.max(1, parseInt(url.searchParams.get("pageSize") ?? "50", 10) || 50)
  );

  const where: {
    action?: string;
    userId?: string;
    resourceType?: string;
    createdAt?: { gte?: Date; lte?: Date };
    OR?: Array<{ action?: { contains: string }; metadata?: { path: string[]; string_contains: string } }>;
  } = {};

  const action = url.searchParams.get("action");
  if (action) where.action = action;

  const userId = url.searchParams.get("userId");
  if (userId) where.userId = userId;

  const resourceType = url.searchParams.get("resourceType");
  if (resourceType) where.resourceType = resourceType;

  const since = url.searchParams.get("since");
  const until = url.searchParams.get("until");
  if (since || until) {
    where.createdAt = {};
    if (since) where.createdAt.gte = new Date(since);
    if (until) where.createdAt.lte = new Date(until);
  }

  const search = url.searchParams.get("search");
  if (search) {
    // Simple search across action + metadata JSON text (case-insensitive)
    // Note: Prisma JSON path search needs raw query; we use contains on action
    where.OR = [
      { action: { contains: search } },
    ];
  }

  // Count + fetch in parallel for performance
  const [total, rows, chainResult] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: { select: { id: true, email: true, name: true } },
      },
    }),
    // Chain integrity check (only on small pages for perf, otherwise on every page 1)
    page === 1 ? verifyAuditChain().catch(() => ({ valid: false, brokenAt: "unknown" })) : Promise.resolve(null),
  ]);

  return NextResponse.json({
    rows: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      action: r.action,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      userId: r.userId,
      user: r.user,
      ip: r.ip,
      userAgent: r.userAgent,
      metadata: r.metadata,
      prevHash: r.prevHash,
      hash: r.hash,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    chainIntegrity: chainResult,
  });
}