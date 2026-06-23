import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/security/audit";
import { verifyApiKey } from "@/lib/security/api-key";

/**
 * POST /api/ingest/apps
 *
 * Webhook-style ingest endpoint for user access audit events.
 * Auth: X-API-Key header (per-app key, bcrypt-hashed in DB).
 * No session required (this is a public webhook URL).
 *
 * Body shape (schema-light — flexible to app-specific needs):
 * {
 *   "timestamp": "2026-06-23T10:00:00Z",     // optional, defaults to server-now
 *   "event_type": "user.login",              // required
 *   "severity": "INFO",                      // optional, default INFO
 *   "actor": {                               // optional
 *     "user_id": "u_123",
 *     "email": "admin@example.com",
 *     "username": "admin",
 *     "ip": "10.0.0.5",
 *     "user_agent": "Mozilla/5.0..."
 *   },
 *   "target": {                              // optional
 *     "type": "user" | "role" | "permission" | "resource" | "session",
 *     "id": "u_456",
 *     "name": "john.doe"
 *   },
 *   "message": "User admin logged in from new device", // required
 *   "metadata": { ... },                     // optional, arbitrary JSON
 *   "request_id": "req_abc",                 // optional
 *   "session_id": "sess_xyz"                 // optional
 * }
 *
 * Returns:
 *   202 { id, assetId, deduped: false, count }
 *   401 { error: "invalid api key" }
 *   400 { error: "validation error", details }
 *   429 { error: "rate limit exceeded" }
 */

// Allowed event types — locked to user access scope per Bos's spec
// (2026-06-23). Other types are rejected to keep audit log clean.
const ALLOWED_EVENT_TYPES = new Set([
  "user.login",
  "user.logout",
  "user.login_failed",
  "user.created",
  "user.deleted",
  "user.updated",
  "user.role_changed",
  "user.permission_granted",
  "user.permission_revoked",
  "session.created",
  "session.expired",
  "password.changed",
  "password.reset_requested",
  "mfa.enabled",
  "mfa.disabled",
  "custom",
]);

const ingestSchema = z.object({
  timestamp: z.string().datetime().optional(),
  event_type: z.string().min(1).max(64).refine((v) => ALLOWED_EVENT_TYPES.has(v), {
    message: `event_type must be one of: ${[...ALLOWED_EVENT_TYPES].join(", ")}`,
  }),
  severity: z.enum(["INFO", "WARN", "ERROR", "CRITICAL"]).optional().default("INFO"),
  actor: z
    .object({
      user_id: z.string().max(128).optional(),
      email: z.string().email().max(254).optional(),
      username: z.string().max(128).optional(),
      ip: z.string().max(64).optional(),
      user_agent: z.string().max(1024).optional(),
    })
    .optional(),
  target: z
    .object({
      type: z.enum(["user", "role", "permission", "resource", "session"]).optional(),
      id: z.string().max(128).optional(),
      name: z.string().max(256).optional(),
    })
    .optional(),
  message: z.string().min(1).max(2048),
  metadata: z.record(z.string(), z.unknown()).optional(),
  request_id: z.string().max(128).optional(),
  session_id: z.string().max(128).optional(),
});

// Simple in-memory rate limiter (per appId) — keyed by appId for fairness
// across multiple keys. For production, swap with Redis/Upstash.
const RATE_LIMIT_PER_SECOND = 100;
const RATE_LIMIT_BURST = 500;
const rateBuckets = new Map<string, { tokens: number; lastRefill: number }>();

function checkRateLimit(appId: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(appId) ?? { tokens: RATE_LIMIT_BURST, lastRefill: now };
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(
    RATE_LIMIT_BURST,
    bucket.tokens + elapsed * RATE_LIMIT_PER_SECOND
  );
  bucket.lastRefill = now;
  if (bucket.tokens < 1) {
    rateBuckets.set(appId, bucket);
    return false;
  }
  bucket.tokens -= 1;
  rateBuckets.set(appId, bucket);
  return true;
}

// --- API key hashing moved to src/lib/security/api-key.ts (shared) ---

export async function POST(req: NextRequest) {
  const start = Date.now();

  // ── 1. Auth: extract X-API-Key ─────────────────────────────────
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey || apiKey.length < 16 || apiKey.length > 256) {
    return NextResponse.json(
      { error: "missing or invalid X-API-Key header" },
      { status: 401 }
    );
  }

  // Look up by prefix (first 8 chars) for fast lookup, then scrypt-verify
  const prefix = apiKey.slice(0, 8);
  const asset = await prisma.asset.findFirst({
    where: { apiKeyPrefix: prefix, apiKeyHash: { not: null } },
    select: {
      id: true,
      displayName: true,
      apiKeyHash: true,
      status: true,
    },
  });
  if (!asset || !asset.apiKeyHash) {
    return NextResponse.json({ error: "invalid api key" }, { status: 401 });
  }

  // scrypt verify (constant-time, format: scrypt$N=16384$<salt-hex>$<hash-hex>)
  const valid = verifyApiKey(apiKey, asset.apiKeyHash);
  if (!valid) {
    return NextResponse.json({ error: "invalid api key" }, { status: 401 });
  }

  // ── 2. Rate limit ──────────────────────────────────────────────
  if (!checkRateLimit(asset.id)) {
    return NextResponse.json(
      { error: "rate limit exceeded", retryAfter: 1 },
      { status: 429, headers: { "Retry-After": "1" } }
    );
  }

  // ── 3. Body validation ─────────────────────────────────────────
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = ingestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation error", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const eventTime = data.timestamp ? new Date(data.timestamp) : new Date();

  // ── 4. Dedup: same (assetId, eventType, actorUserId/email, targetId) within 60s ─
  const dedupStart = new Date(eventTime.getTime() - 60_000);
  const existing = await prisma.tEventLogUserAccess.findFirst({
    where: {
      assetId: asset.id,
      eventType: data.event_type,
      actorUserId: data.actor?.user_id ?? null,
      actorEmail: data.actor?.email ?? null,
      targetId: data.target?.id ?? null,
      eventTime: { gte: dedupStart },
    },
    select: { id: true, count: true },
  });

  if (existing) {
    await prisma.tEventLogUserAccess.update({
      where: { id: existing.id },
      data: {
        count: { increment: 1 },
        eventTime,
        message: data.message,
        metadata: (data.metadata ?? null) as any,
      },
    });
    await prisma.asset.update({
      where: { id: asset.id },
      data: { apiKeyLastUsedAt: new Date() },
    });
    return NextResponse.json(
      { id: existing.id, assetId: asset.id, deduped: true, count: existing.count + 1 },
      { status: 202 }
    );
  }

  // ── 5. Insert event ────────────────────────────────────────────
  const event = await prisma.tEventLogUserAccess.create({
    data: {
      assetId: asset.id,
      eventType: data.event_type,
      severity: data.severity,
      actorUserId: data.actor?.user_id ?? null,
      actorEmail: data.actor?.email ?? null,
      actorUsername: data.actor?.username ?? null,
      actorIp: data.actor?.ip ?? null,
      actorUserAgent: data.actor?.user_agent ?? null,
      targetType: data.target?.type ?? null,
      targetId: data.target?.id ?? null,
      targetName: data.target?.name ?? null,
      requestId: data.request_id ?? null,
      sessionId: data.session_id ?? null,
      message: data.message,
      metadata: (data.metadata ?? null) as any,
      rawData: rawBody as any,
      eventTime,
      count: 1,
    },
    select: { id: true },
  });

  // ── 6. Update apiKeyLastUsedAt (best-effort, no await) ──────────
  prisma.asset
    .update({
      where: { id: asset.id },
      data: { apiKeyLastUsedAt: new Date() },
    })
    .catch(() => {});

  // ── 7. Optional: trigger alert for ERROR/CRITICAL (deferred for v1) ─

  // ── 8. Audit log (sampled for high-volume events) ──────────────
  // Sample 1% of INFO/WARN events to keep audit log from exploding.
  // ERROR/CRITICAL always logged.
  const shouldAudit =
    data.severity === "ERROR" || data.severity === "CRITICAL" || Math.random() < 0.01;
  if (shouldAudit) {
    await audit({
      userId: null,
      action: "apps.ingest",
      resourceType: "user_access_event",
      ip: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown",
      userAgent: req.headers.get("user-agent") ?? "unknown",
      metadata: {
        appName: asset.displayName,
        assetId: asset.id,
        eventType: data.event_type,
        severity: data.severity,
        actorEmail: data.actor?.email ?? null,
        eventId: event.id,
        latencyMs: Date.now() - start,
      },
    });
  }

  return NextResponse.json(
    { id: event.id, assetId: asset.id, deduped: false, count: 1 },
    { status: 202 }
  );
}