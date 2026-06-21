/**
 * /api/mock/clear — Delete mock data (OWNER only)
 *
 * DELETE /api/mock/clear
 * Body: { batchId?: string }  // optional — clear only specific batch
 *
 * Deletes assets where hostname starts with "mock-".
 * Cascades to server_events, db_events (via FK onDelete: Cascade),
 * and to alerts (via FK onDelete: SetNull → then explicit delete).
 *
 * OWASP A01:2021 — OWNER-only access (requireRole with OWNER)
 * OWASP A09:2021 — audit logged
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/security/rbac";
import { audit } from "@/lib/security/audit";

export async function DELETE(req: NextRequest) {
  const auth = await requireRole("OWNER");
  if (auth instanceof NextResponse) return auth;
  const session = auth;

  let batchId: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    batchId = typeof body?.batchId === "string" ? body.batchId : undefined;
  } catch {
    batchId = undefined;
  }

  try {
    // Find all mock assets for this user
    const mockAssets = await prisma.asset.findMany({
      where: {
        userId: session.userId,
        hostname: batchId
          ? { startsWith: `mock-${batchId}-` }
          : { startsWith: "mock-" },
      },
      select: { id: true, hostname: true },
    });

    if (mockAssets.length === 0) {
      return NextResponse.json({
        ok: true,
        deleted: { assets: 0, serverEvents: 0, dbEvents: 0, alerts: 0 },
        message: "No mock data found to clear",
      });
    }

    // Note: alerts have onDelete: SetNull FK, so deleting the asset
    // clears the link but does NOT delete the alert row itself.
    // We need to delete alerts that point to mock assets explicitly.
    // Since the assetId is being set to NULL on cascade, we use a different
    // strategy: find alerts whose metadata.mockBatchId matches, OR that
    // are linked to any mock-* asset. We use the raw metadata check via
    // a Prisma raw query to avoid the JSON path filter restriction.
    const assetIds = mockAssets.map((a) => a.id);

    // First, count alerts that will be deleted
    const [serverAuthCount, databaseEventsCount, alertsCount] = await Promise.all([
      prisma.tEventLogServerAuth.count({ where: { assetId: { in: assetIds } } }),
      prisma.tEventLogDatabase.count({ where: { assetId: { in: assetIds } } }),
      // For alerts: in batched mode, count via JSON path on metadata.mockBatchId.
      // In "all mock" mode, count alerts that have a mockBatchId set (any value).
      batchId
        ? prisma.$queryRaw<Array<{ count: bigint }>>`
            SELECT COUNT(*)::bigint AS count
            FROM alerts
            WHERE metadata->>'mockBatchId' = ${batchId}
          `.then((rows) => Number(rows[0]?.count ?? 0))
        : prisma.$queryRaw<Array<{ count: bigint }>>`
            SELECT COUNT(*)::bigint AS count
            FROM alerts
            WHERE metadata ? 'mockBatchId'
          `.then((rows) => Number(rows[0]?.count ?? 0)),
    ]);

    // Delete alerts explicitly (SetNull doesn't cascade to delete)
    // For batched clear, we use metadata.mockBatchId. For "all mock", we
    // delete any alert linked to a mock asset OR with mockBatchId in metadata.
    if (batchId) {
      await prisma.$executeRaw`
        DELETE FROM alerts WHERE metadata->>'mockBatchId' = ${batchId}
      `;
    } else {
      // Delete all alerts whose asset_id is in our mock asset list
      // (or already null due to prior partial cascade)
      await prisma.alert.deleteMany({
        where: { assetId: { in: assetIds } },
      });
      // Also catch any alerts orphaned by earlier SetNull cascades
      await prisma.$executeRaw`
        DELETE FROM alerts
        WHERE metadata->>'mockBatchId' IS NOT NULL
        AND asset_id IS NULL
      `;
    }

    // Delete assets (cascades to server_events, db_events, asset_credentials)
    await prisma.asset.deleteMany({
      where: { id: { in: assetIds } },
    });

    await audit({
      userId: session.userId,
      action: "mock.clear",
      resourceType: "mock_data",
      metadata: { batchId: batchId ?? "all", assetCount: assetIds.length },
    });

    return NextResponse.json({
      ok: true,
      batchId: batchId ?? null,
      deleted: {
        assets: assetIds.length,
        serverEvents: serverAuthCount,
        dbEvents: databaseEventsCount,
        alerts: alertsCount,
      },
    });
  } catch (err) {
    console.error("[mock/clear] failed", err);
    return NextResponse.json(
      { error: "Failed to clear mock data", details: String(err) },
      { status: 500 }
    );
  }
}

// GET — list current mock batches + counts (for UI status display)
export async function GET() {
  const auth = await requireRole("OWNER");
  if (auth instanceof NextResponse) return auth;
  const session = auth;

  try {
    const mockAssets = await prisma.asset.findMany({
      where: { userId: session.userId, hostname: { startsWith: "mock-" } },
      select: { id: true, hostname: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    // Group by batchId (extract from hostname: "mock-{batchId}-{n}-{name}.test.local")
    const batchMap = new Map<string, { count: number; firstCreated: Date; lastCreated: Date; assetIds: string[] }>();
    for (const a of mockAssets) {
      const m = a.hostname.match(/^mock-([a-z0-9]+)-/);
      if (!m) continue;
      const bId = m[1];
      const existing = batchMap.get(bId);
      if (existing) {
        existing.count += 1;
        existing.assetIds.push(a.id);
        if (a.createdAt < existing.firstCreated) existing.firstCreated = a.createdAt;
        if (a.createdAt > existing.lastCreated) existing.lastCreated = a.createdAt;
      } else {
        batchMap.set(bId, {
          count: 1,
          firstCreated: a.createdAt,
          lastCreated: a.createdAt,
          assetIds: [a.id],
        });
      }
    }

    const batches = Array.from(batchMap.entries()).map(([bId, info]) => ({
      batchId: bId,
      assetCount: info.count,
      createdAt: info.firstCreated.toISOString(),
    }));

    return NextResponse.json({
      ok: true,
      totalMockAssets: mockAssets.length,
      batches,
    });
  } catch (err) {
    console.error("[mock/clear GET] failed", err);
    return NextResponse.json({ error: "Failed to list mock data" }, { status: 500 });
  }
}
