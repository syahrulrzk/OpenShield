#!/usr/bin/env node
/**
 * OpenShield — Migrate existing agents to sequential display IDs (OP-01, OP-02, ...).
 *
 * Usage:
 *   node scripts/migrate-agent-display-id.mjs           # dry-run
 *   node scripts/migrate-agent-display-id.mjs --apply   # apply changes
 *
 * Behavior:
 *   - Lists all agents ordered by registeredAt ASC
 *   - Assigns OP-01 to oldest, OP-02 to next, etc.
 *   - Skips agents that already have a valid displayId
 *   - Logs a table preview before applying
 */

import { PrismaClient } from "@prisma/client";

const PREFIX = "OP-";
const PADDING = 2;

function formatDisplayId(n) {
  return `${PREFIX}${String(n).padStart(PADDING, "0")}`;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient();

  try {
    // Fetch all agents sorted by registeredAt ASC
    const agents = await prisma.agent.findMany({
      orderBy: { registeredAt: "asc" },
      select: {
        id: true,
        name: true,
        displayId: true,
        version: true,
        hostname: true,
        registeredAt: true,
      },
    });

    if (agents.length === 0) {
      console.log("No agents in database. Nothing to migrate.");
      return;
    }

    // Build assignment plan
    const plan = [];
    let nextN = 1;
    for (const agent of agents) {
      if (agent.displayId && /^[A-Z]+-\d+$/.test(agent.displayId)) {
        // Skip — already has a valid displayId
        plan.push({ ...agent, action: "skip", newDisplayId: agent.displayId });
        continue;
      }
      const candidate = formatDisplayId(nextN);
      plan.push({ ...agent, action: "assign", newDisplayId: candidate });
      nextN++;
    }

    // Preview
    console.log("\n=== Migration Plan ===\n");
    console.log(
      "  Action | displayId (new) | cuid (id)                  | name         | hostname   | registeredAt",
    );
    console.log(
      "  -------|------------------|----------------------------|--------------|------------|-------------------------",
    );
    for (const p of plan) {
      console.log(
        `  ${p.action.padEnd(6)} | ${(p.newDisplayId || "—").padEnd(16)} | ${p.id.padEnd(28)} | ${p.name.padEnd(12)} | ${(p.hostname || "—").padEnd(10)} | ${p.registeredAt?.toISOString()}`,
      );
    }

    const toAssign = plan.filter((p) => p.action === "assign");
    console.log(`\nTotal: ${plan.length}, to assign: ${toAssign.length}, to skip: ${plan.length - toAssign.length}`);

    if (!apply) {
      console.log("\n[DRY-RUN] No changes applied. Run with --apply to commit.");
      return;
    }

    // Apply
    console.log("\n[APPLYING] Updating database...\n");
    for (const p of toAssign) {
      await prisma.agent.update({
        where: { id: p.id },
        data: { displayId: p.newDisplayId },
      });
      console.log(`  ✓ ${p.id} → ${p.newDisplayId}`);
    }
    console.log(`\n✅ Migration complete: ${toAssign.length} agents updated.`);
  } catch (e) {
    console.error("Migration failed:", e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
