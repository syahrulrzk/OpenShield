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

/**
 * Console-log every login event the ingest endpoint receives so the
 * server-side log shows the source IP explicitly (not just the DB row).
 *
 * Format (whitespace-separated key=value, easy to grep/awk):
 *   [evt] <ISO>  kind=<ssh|db>  env=<ENV>  asset=<hostname>  user=<u>  ip=<x.x.x.x>  status=<S>  method=<m>  db=<name>?
 *
 * Colors:
 *   - status SUCCESS → green; FAILED/INVALID/DENIED → red
 *   - environment PROD → bold red (critical), STAGING → yellow, UAT → blue,
 *     DEV → dim gray, DR → cyan. This makes PROD-only attacks jump out when
 *     tailing the log, even before reading the line content.
 */
const ENV_COLOR: Record<string, string> = {
  PROD: "\x1b[1;31m",     // bold red — production = most important
  STAGING: "\x1b[33m",    // yellow
  UAT: "\x1b[34m",        // blue
  DEV: "\x1b[90m",        // bright black (dim gray)
  DR: "\x1b[36m",         // cyan
};

function logEvent(args: {
  assetId: string;
  hostname: string | null;
  environment?: string | null;
  username: string;
  sourceIp: string;
  status: "SUCCESS" | "FAILED" | "INVALID" | "DENIED";
  method?: string | null;
  dbName?: string | null;
  kind: "ssh" | "db";
}) {
  const ts = new Date().toISOString();
  const host = args.hostname ?? args.assetId.slice(0, 8);
  const env = (args.environment ?? "?").toUpperCase();
  const line =
    `[evt] ${ts}  kind=${args.kind}  env=${env}  asset=${host}  ` +
    `user=${args.username}  ip=${args.sourceIp}  status=${args.status}` +
    (args.method ? `  method=${args.method}` : "") +
    (args.dbName ? `  db=${args.dbName}` : "");
  // Status color (red/green)
  const statusColor =
    args.status === "SUCCESS"
      ? "\x1b[32m"
      : args.status === "FAILED" || args.status === "INVALID" || args.status === "DENIED"
      ? "\x1b[31m"
      : "\x1b[0m";
  // Environment badge color (independent from status, so PROD failures
  // still show as red+env=PROD in bold, easy to spot in mixed logs)
  const envColor = ENV_COLOR[env] ?? "\x1b[0m";
  const reset = "\x1b[0m";
  // Use process.stdout.write so the line is emitted immediately (not buffered
  // behind other console.log calls) — important when tailing the dev server.
  process.stdout.write(`${statusColor}${line}  ${envColor}[${env}]${reset}\n`);
}

const serverEventSchema = z.object({
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
        server: z.array(serverEventSchema).optional(),
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

  // Pre-fetch hostnames + environments for all assets in this batch so the
  // log line shows a human-friendly name AND the deployment environment
  // (the asset id is a UUID and unreadable on its own, and env lets ops
  // filter PROD-only attacks with a simple grep).
  const assetIds = Array.from(new Set(body.results.map((r) => r.assetId)));
  const assetRows = await prisma.asset.findMany({
    where: { id: { in: assetIds } },
    select: { id: true, hostname: true, environment: true },
  });
  const hostById = new Map(assetRows.map((a) => [a.id, a.hostname]));
  const envById = new Map(assetRows.map((a) => [a.id, a.environment]));

  // 3. Insert events with idempotency check
  //    Dedup-with-aggregation: same (assetId, username, sourceIp, status)
  //    within a 5-minute window is merged into a single row with count++.
  //    This prevents spam from cronjobs/automated SSH that hit the same
  //    user@ip every minute.
  const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
  const stats = { server: 0, db: 0, deduped: 0, errors: 0 };
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
    if (result.events.server?.length) {
      const hostname = hostById.get(result.assetId) ?? null;
      const environment = envById.get(result.assetId) ?? null;
      for (const e of result.events.server) {
        const eventTime = new Date(e.eventTime);
        // Dedup-with-aggregation: same (assetId, username, sourceIp, status)
        // within 5-minute window → UPDATE count++ and bump eventTime to latest
        const dedupStart = new Date(eventTime.getTime() - DEDUP_WINDOW_MS);
        const existing = await prisma.serverEvent.findFirst({
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
            await prisma.serverEvent.update({
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
          // Don't log dedup'd repeats — would flood the log for cron jobs.
          // First occurrence (the create branch below) is what matters.
          continue;
        }
        try {
          await prisma.serverEvent.create({
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
          stats.server++;
          logEvent({
            assetId: result.assetId,
            hostname,
            environment,
            username: e.username,
            sourceIp: e.sourceIp,
            status: e.status,
            method: e.method ?? null,
            kind: "ssh",
          });
        } catch (err) {
          stats.errors++;
          console.error("[ingest] ssh insert failed", err);
        }
      }
    }

    // Process DB events
    if (result.events.db?.length) {
      const hostname = hostById.get(result.assetId) ?? null;
      const environment = envById.get(result.assetId) ?? null;
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
          if (e.sourceIp) {
            logEvent({
              assetId: result.assetId,
              hostname,
              environment,
              username: e.username,
              sourceIp: e.sourceIp,
              status: e.status,
              dbName: e.database ?? null,
              kind: "db",
            });
          }
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
      sshInserted: stats.server,
      dbInserted: stats.db,
      deduped: stats.deduped,
      errors: stats.errors,
      durationMs: Date.now() - startTime,
    },
  });

  return NextResponse.json({
    ok: true,
    received: {
      server: stats.server,
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
