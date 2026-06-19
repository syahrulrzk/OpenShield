/**
 * OpenShield — Poller Orchestrator
 *
 * Iterates all assets, polls each one (SSH or DB) using stored credentials,
 * collects events, then POSTs them to the local /api/events/ingest endpoint
 * with HMAC signature.
 *
 * Concurrency: limited to N parallel polls to avoid overwhelming resources
 * Failure mode: per-asset errors don't fail the whole run; logged in result
 *
 * Usage:
 *   import { runPollerCycle } from "@/lib/poller";
 *   const result = await runPollerCycle();
 */

import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/security/crypto";
import { pollSshAsset, decryptSshCredential, type SshPollResult } from "./ssh";
import {
  pollDatabase,
  decryptDbCredential,
  type DbPollResult,
} from "./db";
import { signBody, getIngestSecret } from "@/lib/ingest/hmac";
import { audit } from "@/lib/security/audit";
import { randomUUID } from "node:crypto";
import type {
  SshEventInput,
  DbEventInput,
  PollerRunResult,
} from "./types";

const POLLER_ID = `central-poller-${process.env.HOSTNAME ?? "local"}`;
const PARALLEL_LIMIT = 5;
const FETCH_TIMEOUT_MS = 30_000;

type AssetRow = {
  id: string;
  hostname: string;
  category: "SSH" | "DATABASE";
  environment: string;
  userId: string;
  sshUser: string | null;
  sshPort: number;
  dbType: string;
  dbHost: string | null;
  dbPort: number | null;
  dbName: string | null;
  dbUser: string | null;
  pollerCursor: string | null;
  sshCredentials: { sshEncData: string | null } | null;
  dbCredentials: { dbEncData: string | null } | null;
};

/**
 * Main entry: run one polling cycle
 */
export async function runPollerCycle(opts: {
  /** Only poll these asset IDs (default: all) */
  assetIds?: string[];
  /** Skip polling if last poll was less than this many ms ago */
  minIntervalMs?: number;
} = {}): Promise<PollerRunResult> {
  const startedAt = new Date();
  const batchId = randomUUID();

  // 1. Fetch assets to poll
  const where: any = { category: { in: ["SSH", "DATABASE"] } };
  if (opts.assetIds?.length) where.id = { in: opts.assetIds };
  if (opts.minIntervalMs) {
    where.OR = [
      { lastPolledAt: null },
      { lastPolledAt: { lt: new Date(Date.now() - opts.minIntervalMs) } },
    ];
  }

  const assets = await prisma.asset.findMany({
    where,
    select: {
      id: true,
      hostname: true,
      category: true,
      environment: true,
      userId: true,
      sshUser: true,
      sshPort: true,
      dbType: true,
      dbHost: true,
      dbPort: true,
      dbName: true,
      dbUser: true,
      pollerCursor: true,
      sshCredentials: { select: { sshEncData: true } },
      dbCredentials: { select: { dbEncData: true } },
    },
    orderBy: { lastPolledAt: "asc" },
    take: 200, // cap per cycle
  });

  if (assets.length === 0) {
    return {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 0,
      totalAssets: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      eventsCollected: 0,
      eventsInserted: 0,
      errors: [],
    };
  }

  // 2. Mark all as POLLING
  await prisma.asset.updateMany({
    where: { id: { in: assets.map((a) => a.id) } },
    data: { pollerStatus: "POLLING" },
  });

  // 3. Poll in parallel (limited concurrency)
  const results: Array<{
    asset: AssetRow;
    sshResult?: SshPollResult;
    dbResult?: DbPollResult;
    error?: string;
  }> = [];

  // Simple chunked parallel
  for (let i = 0; i < assets.length; i += PARALLEL_LIMIT) {
    const chunk = assets.slice(i, i + PARALLEL_LIMIT);
    const chunkResults = await Promise.all(
      chunk.map((a) => pollSingle(a))
    );
    results.push(...chunkResults);
  }

  // 4. Aggregate events, update cursors, post to ingest
  const allEvents: Array<{
    assetId: string;
    events: { ssh?: SshEventInput[]; db?: DbEventInput[] };
  }> = [];
  const errors: Array<{ assetId: string; hostname: string; error: string }> = [];
  let success = 0;
  let failed = 0;
  let skipped = 0;
  let eventsCollected = 0;

  for (const r of results) {
    const a = r.asset as AssetRow;

    // SSH result
    if (r.sshResult) {
      if (r.sshResult.ok) {
        success++;
        eventsCollected += r.sshResult.events.length;
        allEvents.push({
          assetId: a.id,
          events: { ssh: r.sshResult.events },
        });
        // Update cursor
        await prisma.asset.update({
          where: { id: a.id },
          data: {
            pollerCursor: r.sshResult.newCursor ?? a.pollerCursor,
            pollerStatus: "OK",
            pollerError: null,
            status: "ONLINE",
            lastSeenAt: new Date(),
          },
        });
      } else {
        failed++;
        const errMsg = r.sshResult.error ?? "Unknown SSH error";
        errors.push({ assetId: a.id, hostname: a.hostname, error: errMsg });
        await prisma.asset.update({
          where: { id: a.id },
          data: {
            pollerStatus: "ERROR",
            pollerError: errMsg.slice(0, 500),
            status: "ERROR",
          },
        });
      }
    } else if (r.dbResult) {
      if (r.dbResult.ok) {
        success++;
        eventsCollected += r.dbResult.events.length;
        allEvents.push({
          assetId: a.id,
          events: { db: r.dbResult.events },
        });
        await prisma.asset.update({
          where: { id: a.id },
          data: {
            pollerStatus: "OK",
            pollerError: null,
            status: "ONLINE",
            lastSeenAt: new Date(),
          },
        });
      } else {
        failed++;
        const errMsg = r.dbResult.error ?? "Unknown DB error";
        errors.push({ assetId: a.id, hostname: a.hostname, error: errMsg });
        await prisma.asset.update({
          where: { id: a.id },
          data: {
            pollerStatus: "ERROR",
            pollerError: errMsg.slice(0, 500),
            status: "ERROR",
          },
        });
      }
    } else {
      // Skipped (no creds, etc.)
      skipped++;
      await prisma.asset.update({
        where: { id: a.id },
        data: {
          pollerStatus: "ERROR",
          pollerError: r.error ?? "Skipped",
        },
      });
    }
  }

  // 5. POST events to /api/events/ingest (HMAC signed)
  let eventsInserted = 0;
  if (allEvents.length > 0) {
    try {
      const insertResult = await postToIngest(allEvents, batchId);
      eventsInserted = insertResult;
    } catch (err) {
      console.error("[poller] ingest post failed", err);
      errors.push({
        assetId: "ingest",
        hostname: "internal",
        error: `Ingest failed: ${(err as Error).message}`,
      });
    }
  }

  const finishedAt = new Date();
  const result: PollerRunResult = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    totalAssets: assets.length,
    success,
    failed,
    skipped,
    eventsCollected,
    eventsInserted,
    errors,
  };

  // 6. Audit (userId=null since poller is a system process)
  await audit({
    userId: null,
    action: errors.length > 0 ? "poller.error" : "poller.run",
    resourceType: "poller",
    metadata: {
      batchId,
      totalAssets: result.totalAssets,
      success: result.success,
      failed: result.failed,
      eventsCollected: result.eventsCollected,
      eventsInserted: result.eventsInserted,
      durationMs: result.durationMs,
      errors: result.errors.slice(0, 5), // cap
    },
  });

  return result;
}

async function pollSingle(asset: any): Promise<{
  asset: AssetRow;
  sshResult?: SshPollResult;
  dbResult?: DbPollResult;
  error?: string;
}> {
  const typed = asset as AssetRow;
  try {
    if (typed.category === "SSH") {
      const sshCred = typed.sshCredentials?.sshEncData;
      if (!sshCred) {
        return { asset: typed, error: "No SSH credential stored" };
      }
      const credential = decryptSshCredential(sshCred);
      if (!credential) {
        return { asset: typed, error: "Failed to decrypt SSH credential" };
      }
      const sshUser = typed.sshUser ?? "root";
      // For password auth we need to know the type. Default to key for
      // encrypted blob > 100 chars (key), short = password
      const authType: "key" | "password" = credential.includes("PRIVATE KEY")
        ? "key"
        : "password";

      const result = await pollSshAsset({
        hostname: typed.hostname,
        sshPort: typed.sshPort ?? 22,
        sshUser,
        authType,
        credential,
        cursor: typed.pollerCursor,
      });
      return { asset: typed, sshResult: result };
    } else if (typed.category === "DATABASE") {
      const dbCred = typed.dbCredentials?.dbEncData;
      if (!dbCred) {
        return { asset: typed, error: "No DB credential stored" };
      }
      const cred = decryptDbCredential(dbCred);
      if (!cred) {
        return { asset: typed, error: "Failed to decrypt DB credential" };
      }
      const dbType = typed.dbType as "POSTGRES" | "MYSQL" | "SQLSERVER";
      const host = typed.dbHost ?? typed.hostname;
      const port = typed.dbPort ?? defaultPort(dbType);
      const database = typed.dbName ?? "postgres";
      const result = await pollDatabase({
        dbType,
        host,
        port,
        user: typed.dbUser ?? cred.user,
        password: cred.password,
        database,
      });
      return { asset: typed, dbResult: result };
    }
    return { asset: typed, error: `Unsupported category: ${typed.category}` };
  } catch (err) {
    return {
      asset: typed,
      error: `Poller exception: ${(err as Error).message}`,
    };
  }
}

function defaultPort(dbType: string): number {
  if (dbType === "POSTGRES") return 5432;
  if (dbType === "MYSQL") return 3306;
  if (dbType === "SQLSERVER") return 1433;
  return 0;
}

async function postToIngest(
  results: Array<{
    assetId: string;
    events: { ssh?: SshEventInput[]; db?: DbEventInput[] };
  }>,
  batchId: string
): Promise<number> {
  const body = JSON.stringify({
    polledAt: new Date().toISOString(),
    results,
  });
  const secret = getIngestSecret();
  const sig = signBody(secret, body);

  // Resolve base URL — env or default
  const baseUrl =
    process.env.OPENSHIELD_BASE_URL ?? "http://127.0.0.1:3000";
  const ingestUrl = `${baseUrl}/api/events/ingest`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const res = await fetch(ingestUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Openshield-Signature": sig,
      "X-Openshield-Poller-Id": POLLER_ID,
      "X-Openshield-Batch-Id": batchId,
    },
    body,
    signal: controller.signal,
  });
  clearTimeout(t);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ingest returned ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { received: { ssh: number; db: number } };
  return data.received.ssh + data.received.db;
}

// Convenience re-exports
export { pollSshAsset, decryptSshCredential } from "./ssh";
export { pollDatabase, decryptDbCredential } from "./db";
export { signBody, getIngestSecret } from "@/lib/ingest/hmac";

// Unused decrypt import — keep for tree-shaking guard
void decrypt;
