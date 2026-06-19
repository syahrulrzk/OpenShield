/**
 * /api/events/ingest — receive events from the central poller
 *
 * POST /api/events/ingest
 * Headers:
 *   X-Openshield-Signature: sha256=<hex>
 *   X-Openshield-Poller-Id: <string>   (for audit + rate limiting)
 *   X-Openshield-Batch-Id: <string>   (idempotency key)
 * Body: {
 *   polledAt: ISO timestamp,
 *   results: Array<{
 *     assetId: string,
 *     events: {
 *       ssh?: Array<{ username, sourceIp, status, method?, eventTime, country?, raw? }>,
 *       db?:  Array<{ dbType, username, sourceIp?, database?, status, eventTime, raw? }>
 *     }
 *   }>
 * }
 *
 * Auth: HMAC signature with shared INGEST_HMAC_SECRET
 * Idempotency: dedup on (assetId, eventTime, username, status) within 5s window
 *
 * OWASP A01 — explicit auth via HMAC (deny by default if header missing)
 * OWASP A09 — audit logged
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifySignature, getIngestSecret } from "@/lib/ingest/hmac";
import { z } from "zod";
import { audit } from "@/lib/security/audit";

const sshEventSchema = z.object({
  username: z.string().min(1).max(128),
  sourceIp: z.string().min(1).max(64),
  status: z.enum(["SUCCESS", "FAILED", "INVALID"]),
  method: z.string().max(32).optional(),
  eventTime: z.string().datetime(),
  country: z.string().max(8).optional(),
  raw: z.string().max(4096).optional(),
});

const dbEventSchema = z.object({
  dbType: z.enum(["POSTGRES", "MYSQL", "SQLSERVER"]),
  username: z.string().min(1).max(128),
  sourceIp: z.string().max(64).optional(),
  database: z.string().max(64).optional(),
  status: z.enum(["SUCCESS", "FAILED", "DENIED"]),
  eventTime: z.string().datetime(),
  raw: z.string().max(4096).optional(),
});

const ingestSchema = z.object({
  polledAt: z.string().datetime(),
  results: z.array(
    z.object({
      assetId: z.string().min(1),
      events: z.object({
        ssh: z.array(sshEventSchema).optional(),
        db: z.array(dbEventSchema).optional(),
      }),
    })
  ),
});

export async function POST(req: NextRequest) {
  // 1. Verify HMAC signature — reject if missing or invalid
  const sig = req.headers.get("x-openshield-signature");
  const pollerId = req.headers.get("x-openshield-poller-id") ?? "unknown";
  const batchId = req.headers.get("x-openshield-batch-id") ?? "no-batch";

  // We need raw body for HMAC verify, then parse
  const rawBody = await req.text();
  let secret: string;
  try {
    secret = getIngestSecret();
  } catch (e) {
    console.error("[ingest] INGEST_HMAC_SECRET not configured", e);
    return NextResponse.json(
      { error: "Ingest not configured" },
      { status: 503 }
    );
  }

  if (!verifySignature(secret, rawBody, sig)) {
    await audit({
      userId: null,
      action: "ingest.rejected",
      resourceType: "ingest",
      metadata: {
        reason: "invalid_hmac",
        pollerId,
        batchId,
        sigPresent: !!sig,
        bodyLen: rawBody.length,
      },
    });
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 401 }
    );
  }

  // 2. Parse + validate body
  let body: z.infer<typeof ingestSchema>;
  try {
    body = ingestSchema.parse(JSON.parse(rawBody));
  } catch (err) {
    return NextResponse.json(
      { error: "Invalid body", details: String(err) },
      { status: 400 }
    );
  }

  // 3. Insert events with idempotency check
  //    Dedup-with-aggregation: same (assetId, username, sourceIp, status)
  //    within a 5-minute window is merged into a single row with count++.
  //    This prevents spam from cronjobs/automated SSH that hit the same
  //    user@ip every minute.
  const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
  const stats = { ssh: 0, db: 0, deduped: 0, errors: 0 };
  const startTime = Date.now();

  for (const result of body.results) {
    // Verify asset exists (defense in depth — even if HMAC is good, only
    // insert events for assets we actually know about)
    const asset = await prisma.asset.findUnique({
      where: { id: result.assetId },
      select: { id: true, userId: true, dbType: true },
    });
    if (!asset) {
      stats.errors++;
      continue;
    }

    // Process SSH events
    if (result.events.ssh?.length) {
      for (const e of result.events.ssh) {
        const eventTime = new Date(e.eventTime);
        // Dedup-with-aggregation: same (assetId, username, sourceIp, status)
        // within 5-minute window → UPDATE count++ and bump eventTime to latest
        const dedupStart = new Date(eventTime.getTime() - DEDUP_WINDOW_MS);
        const existing = await prisma.sshEvent.findFirst({
          where: {
            assetId: result.assetId,
            username: e.username,
            sourceIp: e.sourceIp,
            status: e.status,
            eventTime: { gte: dedupStart },
          },
          select: { id: true, count: true },
        });
        if (existing) {
          try {
            await prisma.sshEvent.update({
              where: { id: existing.id },
              data: {
                count: { increment: 1 },
                eventTime, // bump to latest occurrence
              },
            });
            stats.deduped++;
          } catch (err) {
            stats.errors++;
            console.error("[ingest] ssh dedup update failed", err);
          }
          continue;
        }
        try {
          await prisma.sshEvent.create({
            data: {
              assetId: result.assetId,
              username: e.username,
              sourceIp: e.sourceIp,
              status: e.status,
              method: e.method ?? null,
              country: e.country ?? null,
              eventTime,
              raw: e.raw ?? null,
              count: 1,
            },
          });
          stats.ssh++;
        } catch (err) {
          stats.errors++;
          console.error("[ingest] ssh insert failed", err);
        }
      }
    }

    // Process DB events
    if (result.events.db?.length) {
      for (const e of result.events.db) {
        const eventTime = new Date(e.eventTime);
        const dedupStart = new Date(eventTime.getTime() - DEDUP_WINDOW_MS);
        const existing = await prisma.dbEvent.findFirst({
          where: {
            assetId: result.assetId,
            username: e.username,
            database: e.database ?? null,
            status: e.status,
            eventTime: { gte: dedupStart },
          },
          select: { id: true, count: true },
        });
        if (existing) {
          try {
            await prisma.dbEvent.update({
              where: { id: existing.id },
              data: {
                count: { increment: 1 },
                eventTime,
              },
            });
            stats.deduped++;
          } catch (err) {
            stats.errors++;
            console.error("[ingest] db dedup update failed", err);
          }
          continue;
        }
        try {
          await prisma.dbEvent.create({
            data: {
              assetId: result.assetId,
              dbType: e.dbType,
              username: e.username,
              sourceIp: e.sourceIp ?? null,
              database: e.database ?? null,
              status: e.status,
              eventTime,
              raw: e.raw ?? null,
              count: 1,
            },
          });
          stats.db++;
        } catch (err) {
          stats.errors++;
          console.error("[ingest] db insert failed", err);
        }
      }
    }

    // Update asset lastSeenAt + poll stats
    await prisma.asset.update({
      where: { id: result.assetId },
      data: {
        lastSeenAt: new Date(),
        pollerStatus: "OK",
        pollerError: null,
        lastPolledAt: new Date(),
        pollCount: { increment: 1 },
      },
    });
  }

  // 4. Audit log
  await audit({
    userId: null,
    action: "ingest.accepted",
    resourceType: "ingest",
    metadata: {
      pollerId,
      batchId,
      polledAt: body.polledAt,
      sshInserted: stats.ssh,
      dbInserted: stats.db,
      deduped: stats.deduped,
      errors: stats.errors,
      durationMs: Date.now() - startTime,
    },
  });

  return NextResponse.json({
    ok: true,
    received: {
      ssh: stats.ssh,
      db: stats.db,
      deduped: stats.deduped,
      errors: stats.errors,
    },
    durationMs: Date.now() - startTime,
  });
}

/** Health check (no auth) */
export async function GET() {
  let secretOk = false;
  try {
    getIngestSecret();
    secretOk = true;
  } catch {
    secretOk = false;
  }
  return NextResponse.json({
    ok: secretOk,
    endpoint: "/api/events/ingest",
    auth: "HMAC-SHA256 (X-Openshield-Signature header)",
    secretConfigured: secretOk,
  });
}
