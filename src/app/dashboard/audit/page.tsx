/**
 * /dashboard/audit — read-only audit log viewer
 *
 * Features:
 * - Paginated table (50/page default, max 200)
 * - Filter by action, userId, resourceType, date range, free-text search
 * - Chain integrity badge (warns if audit log chain is broken)
 * - JSON metadata viewer (collapsible row details)
 * - Export to CSV
 * - Auto-refresh button
 *
 * Server component fetches initial data, client component handles interactions.
 */

import { redirect } from "next/navigation";
import { getSession } from "@/lib/security/rbac";
import { prisma } from "@/lib/db";
import { verifyAuditChain } from "@/lib/security/audit";
import { AuditContent } from "./_components/audit-content";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AuditPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  // Fetch first page server-side for SSR
  const PAGE_SIZE = 50;

  // Build base query
  const where = {};

  const [rows, total, chainResult, distinctActions] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      include: { user: { select: { id: true, email: true, name: true } } },
    }),
    prisma.auditLog.count({ where }),
    verifyAuditChain().catch(() => ({ valid: false, brokenAt: "unknown" })),
    prisma.auditLog.findMany({
      distinct: ["action"],
      select: { action: true },
      orderBy: { action: "asc" },
    }),
  ]);

  const initialData = {
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
    page: 1,
    pageSize: PAGE_SIZE,
    totalPages: Math.ceil(total / PAGE_SIZE),
  };

  return (
    <main className="min-h-screen px-6 py-8 max-w-7xl mx-auto text-zinc-100">
      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Audit Log
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            {total.toLocaleString()} entries · read-only · hash-chained integrity
          </p>
        </div>
        <nav className="flex items-center gap-3 text-xs">
          <a
            href="/dashboard"
            className="text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            ← Dashboard
          </a>
          <a
            href="/dashboard/server"
            className="text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Server Events →
          </a>
        </nav>
      </header>

      <AuditContent
        initialData={initialData}
        chainIntegrity={chainResult}
        knownActions={distinctActions.map((a) => a.action)}
      />
    </main>
  );
}