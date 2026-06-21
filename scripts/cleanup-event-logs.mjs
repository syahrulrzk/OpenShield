#!/usr/bin/env node
/**
 * OpenShield Event Log Retention Cleanup
 *
 * Removes old event log rows based on per-table retention policy.
 * Designed to be run by systemd timer (daily) OR manually for ops.
 *
 * Retention policy (controlled via env vars, defaults shown):
 *   EVENTLOG_RETENTION_HIGH  = 40 days  (server_auth, apps, database)
 *   EVENTLOG_RETENTION_LOW   = 3 days   (fim, syslog, auditd)
 *
 * Outputs structured log lines (JSON-ish) so journald can ingest them,
 * and writes an audit_log row at the end of each run summarizing the work.
 *
 * Usage:
 *   node scripts/cleanup-event-logs.mjs            # actual cleanup
 *   node scripts/cleanup-event-logs.mjs --dry-run  # just report what would be deleted
 */

import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";

// Re-use the same global Prisma instance pattern as src/lib/db.ts
// to avoid "too many clients" warnings when run via tsx/script.
const globalForPrisma = globalThis;
const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["warn", "error"],
  });
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// ---------- Audit chain helpers (mirror src/lib/security/audit.ts) ----------

function canonical(row) {
  // Stable JSON: sort keys alphabetically. Use a deterministic representation.
  const sorted = {};
  for (const k of Object.keys(row).sort()) sorted[k] = row[k];
  return JSON.stringify(sorted);
}

function hashRow(prevHash, row) {
  return createHash("sha256")
    .update((prevHash ?? "GENESIS") + "|" + canonical(row))
    .digest("hex");
}

async function appendAudit(row) {
  const ts = new Date();
  const last = await prisma.auditLog.findFirst({
    orderBy: { createdAt: "desc" },
    select: { hash: true },
  });
  const prevHash = last?.hash ?? null;
  const payload = {
    action: row.action,
    actor: row.actor ?? null,
    resourceType: row.resourceType ?? null,
    resourceId: row.resourceId ?? null,
    ip: row.ip ?? null,
    userAgent: row.userAgent ?? null,
    metadata: row.metadata ?? null,
    ts: ts.toISOString(),
  };
  const hash = hashRow(prevHash, payload);
  try {
    await prisma.auditLog.create({
      data: {
        userId: null, // system actor — not a user
        action: row.action,
        resourceType: row.resourceType ?? null,
        resourceId: row.resourceId ?? null,
        ip: row.ip ?? null,
        userAgent: row.userAgent ?? null,
        metadata: row.metadata ?? null,
        prevHash,
        hash,
        createdAt: ts,
      },
    });
    return true;
  } catch (err) {
    log("warn", "audit append failed (non-fatal)", { error: err.message });
    return false;
  }
}

// ---------- Config ----------

const HIGH_DAYS = parseInt(
  process.env.EVENTLOG_RETENTION_HIGH || "40",
  10
);
const LOW_DAYS = parseInt(
  process.env.EVENTLOG_RETENTION_LOW || "3",
  10
);

const DRY_RUN = process.argv.includes("--dry-run");

const now = new Date();
const cutoffHigh = new Date(now.getTime() - HIGH_DAYS * 24 * 60 * 60 * 1000);
const cutoffLow = new Date(now.getTime() - LOW_DAYS * 24 * 60 * 60 * 1000);

// ---------- Retention map ----------

// Each entry: { table (Prisma model), cutoff date, label for logging }
const RETENTION = [
  // Low retention (3 days default) — high-volume, low-long-term-value
  { model: "tEventLogSyslog", cutoff: cutoffLow, days: LOW_DAYS, label: "syslog" },
  { model: "tEventLogFim", cutoff: cutoffLow, days: LOW_DAYS, label: "fim" },
  { model: "tEventLogAuditd", cutoff: cutoffLow, days: LOW_DAYS, label: "auditd" },
  // High retention (40 days default) — security-relevant, audit value
  { model: "tEventLogServerAuth", cutoff: cutoffHigh, days: HIGH_DAYS, label: "server_auth" },
  { model: "tEventLogApps", cutoff: cutoffHigh, days: HIGH_DAYS, label: "apps" },
  { model: "tEventLogDatabase", cutoff: cutoffHigh, days: HIGH_DAYS, label: "database" },
];

function log(level, msg, extra = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    component: "event-log-cleanup",
    ...extra,
  };
  // Single-line JSON for journald ingestion
  process.stdout.write(JSON.stringify(entry) + "\n");
}

// ---------- Main ----------

async function main() {
  log("info", "starting cleanup", {
    dryRun: DRY_RUN,
    highDays: HIGH_DAYS,
    lowDays: LOW_DAYS,
    now: now.toISOString(),
    cutoffHigh: cutoffHigh.toISOString(),
    cutoffLow: cutoffLow.toISOString(),
  });

  const summary = [];
  let totalDeleted = 0;

  for (const { model, cutoff, days, label } of RETENTION) {
    const prismaModel = prisma[model];
    if (!prismaModel) {
      log("error", "unknown model", { model });
      continue;
    }

    try {
      // Count first (for log + audit summary)
      const count = await prismaModel.count({
        where: { eventTime: { lt: cutoff } },
      });

      if (count === 0) {
        log("info", "nothing to delete", { model, days, label });
        summary.push({ model, days, deleted: 0 });
        continue;
      }

      if (DRY_RUN) {
        log("info", "DRY-RUN would delete", {
          model,
          days,
          label,
          wouldDelete: count,
          cutoff: cutoff.toISOString(),
        });
        summary.push({ model, days, deleted: 0, wouldDelete: count });
        continue;
      }

      // Delete in batches to avoid long locks on large tables.
      // Each batch is one transaction; if N is small we just delete all.
      const BATCH_SIZE = 5000;
      let deleted = 0;
      while (true) {
        // findMany to get IDs (more portable than `deleteMany` limit)
        const old = await prismaModel.findMany({
          where: { eventTime: { lt: cutoff } },
          select: { id: true },
          take: BATCH_SIZE,
        });
        if (old.length === 0) break;

        const result = await prismaModel.deleteMany({
          where: { id: { in: old.map((r) => r.id) } },
        });
        deleted += result.count;
        totalDeleted += result.count;

        if (old.length < BATCH_SIZE) break;
      }

      log("info", "cleanup complete", {
        model,
        days,
        label,
        deleted,
        cutoff: cutoff.toISOString(),
      });
      summary.push({ model, days, deleted });
    } catch (err) {
      log("error", "cleanup failed", {
        model,
        label,
        error: err.message,
        stack: err.stack,
      });
      summary.push({ model, days, deleted: 0, error: err.message });
      // Continue with other tables — don't let one failure abort the whole run
    }
  }

  // Audit log entry — best-effort (don't fail cleanup if audit fails)
  try {
    const ok = await appendAudit({
      action: "eventlog.cleanup",
      resourceType: "system",
      metadata: {
        dryRun: DRY_RUN,
        highDays: HIGH_DAYS,
        lowDays: LOW_DAYS,
        totalDeleted,
        summary,
        ranAt: now.toISOString(),
      },
    });
    log(ok ? "info" : "warn", "audit log written", { totalDeleted, summary });
  } catch (err) {
    log("warn", "audit log failed (non-fatal)", { error: err.message });
  }

  log("info", "cleanup finished", { totalDeleted, summary });
  await prisma.$disconnect();
  // Exit 0 even if some tables errored — operator inspects logs
  process.exit(0);
}

main().catch(async (err) => {
  log("error", "fatal", { error: err.message, stack: err.stack });
  try {
    await prisma.$disconnect();
  } catch {}
  process.exit(1);
});