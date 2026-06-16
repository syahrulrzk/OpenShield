/**
 * /api/health — liveness/readiness probe
 * No auth required. Returns minimal info (no version leak).
 */

import { prisma } from "@/lib/db";

export async function GET() {
  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }
  return Response.json(
    { status: dbOk ? "ok" : "degraded", db: dbOk, ts: new Date().toISOString() },
    { status: dbOk ? 200 : 503 }
  );
}
