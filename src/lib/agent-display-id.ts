/**
 * OpenShield — Agent Display ID Generator
 *
 * Generates sequential, human-friendly agent IDs like "OP-01", "OP-02".
 * Atomic, race-safe via Prisma transaction + raw SQL.
 *
 * Usage:
 *   const displayId = await generateNextDisplayId(); // "OP-01"
 *
 * Naming convention:
 *   OP = "OpenShield Protective" / OpenShield Prefix
 *   01-99 = sequential zero-padded 2-digit (supports up to 99 agents)
 *
 * For >99 agents, extend to 3-digit via DISPLAY_ID_PADDING in config.
 *
 * NEVER reuse numbers — even after agent delete. Gaps are OK.
 * Reserved: OP-00 = system/built-in.
 */

import { PrismaClient, Prisma } from "@prisma/client";

const PREFIX = "OP-";
const PADDING = 2; // OP-01, OP-02, ..., OP-99
const RESERVED_IDS = new Set(["OP-00"]); // reserved numbers

/**
 * Generate the next available display ID.
 * Atomic via Prisma transaction with SERIALIZABLE isolation.
 */
export async function generateNextDisplayId(
  prisma: PrismaClient,
): Promise<string> {
  return await prisma.$transaction(
    async (tx) => {
      // Find all existing display IDs, pick the highest numeric suffix
      const agents = await tx.$queryRaw<Array<{ display_id: string }>>`
        SELECT display_id FROM "agents"
        WHERE display_id IS NOT NULL
        ORDER BY display_id DESC
      `;

      let maxN = 0;
      for (const row of agents) {
        const n = parseDisplayId(row.display_id);
        if (n !== null && n > maxN) maxN = n;
      }

      const nextN = maxN + 1;

      // Validate range
      const maxAllowed = Math.pow(10, PADDING) - 1; // 99 for PADDING=2
      if (nextN > maxAllowed) {
        throw new Error(
          `Display ID exhausted (max ${PREFIX}${String(maxAllowed).padStart(PADDING, "0")}). Increase PADDING.`,
        );
      }

      const candidate = `${PREFIX}${String(nextN).padStart(PADDING, "0")}`;
      if (RESERVED_IDS.has(candidate)) {
        throw new Error(`Reserved display ID: ${candidate}`);
      }
      return candidate;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

/**
 * Parse "OP-01" → 1. Returns null if not a valid display ID format.
 */
export function parseDisplayId(displayId: string | null | undefined): number | null {
  if (!displayId) return null;
  const m = displayId.match(new RegExp(`^${PREFIX}(\\d+)$`));
  if (!m) return null;
  return parseInt(m[1], 10);
}

/**
 * Format a number into display ID format, e.g. 1 → "OP-01".
 */
export function formatDisplayId(n: number): string {
  return `${PREFIX}${String(n).padStart(PADDING, "0")}`;
}

/**
 * Validate display ID format (e.g. "OP-01", "OP-99").
 */
export function isValidDisplayId(displayId: string): boolean {
  return new RegExp(`^${PREFIX}\\d{1,${PADDING}}$`).test(displayId);
}
