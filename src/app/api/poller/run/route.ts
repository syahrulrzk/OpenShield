/**
 * /api/poller/run — trigger one poller cycle
 *
 * POST /api/poller/run
 *   Body (optional): { assetIds?: string[]; minIntervalMs?: number }
 *
 *   Runs a poller cycle. Can be called:
 *     - Manually from the UI ("Run poll now" button)
 *     - From a cron job (e.g. every 30s via container sidecar)
 *     - From the in-process scheduler (if enabled)
 *
 * Auth: OWNER or ADMIN (for manual triggers), or HMAC-signed for cron jobs
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/security/rbac";
import { verifySignature, getIngestSecret } from "@/lib/ingest/hmac";
import { runPollerCycle } from "@/lib/poller";

export async function POST(req: NextRequest) {
  // Two auth paths:
  //   1) Session cookie (manual UI trigger)
  //   2) HMAC signature (cron job)
  const sig = req.headers.get("x-openshield-signature");
  let isAuthorized = false;

  if (sig) {
    // Cron job auth
    const rawBody = await req.text();
    let secret: string;
    try {
      secret = getIngestSecret();
    } catch {
      return NextResponse.json(
        { error: "Ingest not configured" },
        { status: 503 }
      );
    }
    isAuthorized = verifySignature(secret, rawBody, sig);
    if (!isAuthorized) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
    // Continue with the body
    try {
      const body = rawBody ? JSON.parse(rawBody) : {};
      const result = await runPollerCycle({
        assetIds: body.assetIds,
        minIntervalMs: body.minIntervalMs,
      });
      return NextResponse.json(result);
    } catch (err) {
      return NextResponse.json(
        { error: "Poller run failed", details: String(err) },
        { status: 500 }
      );
    }
  } else {
    // UI auth
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;
    if (session.role !== "OWNER" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    isAuthorized = true;
  }

  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // UI path — read body
  let body: { assetIds?: string[]; minIntervalMs?: number } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body OK */
  }

  try {
    const result = await runPollerCycle({
      assetIds: body.assetIds,
      minIntervalMs: body.minIntervalMs,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: "Poller run failed", details: String(err) },
      { status: 500 }
    );
  }
}

/** GET — show poller status of all assets */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof NextResponse) return session;

  const assets = await (await import("@/lib/db")).prisma.asset.findMany({
    where: { category: { in: ["SSH", "DATABASE"] } },
    select: {
      id: true,
      hostname: true,
      category: true,
      environment: true,
      pollerStatus: true,
      pollerError: true,
      lastPolledAt: true,
      pollCount: true,
      lastSeenAt: true,
      status: true,
    },
    orderBy: { lastPolledAt: "desc" },
  });

  return NextResponse.json({ ok: true, assets });
}
