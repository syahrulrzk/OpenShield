/**
 * OpenShield — Rate Limiting (Redis-backed via BullMQ-compatible store)
 *
 * OWASP A07:2021 + API4:2023 — Resource Consumption protection
 *
 * Uses simple in-memory store (Map) for MVP. For multi-instance production,
 * swap with Redis-backed implementation.
 *
 * Limits:
 * - login: 5 attempts / 15 min per IP
 * - api: 100 req / min per user
 * - asset-add: 10 / hour per user
 * - credential-view: 30 / hour per user
 */

type Bucket = { count: number; resetAt: number };

const store = new Map<string, Bucket>();

export type RateLimitConfig = {
  max: number;
  windowMs: number;
};

export const LIMITS = {
  login: { max: 5, windowMs: 15 * 60_000 } as RateLimitConfig,
  api: { max: 100, windowMs: 60_000 } as RateLimitConfig,
  assetAdd: { max: 10, windowMs: 60 * 60_000 } as RateLimitConfig,
  credentialView: { max: 30, windowMs: 60 * 60_000 } as RateLimitConfig,
} as const;

export type RateLimitResult =
  | { ok: true; remaining: number; resetAt: number }
  | { ok: false; retryAfterSec: number; resetAt: number };

export function check(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const bucket = store.get(key);

  if (!bucket || bucket.resetAt < now) {
    const resetAt = now + config.windowMs;
    store.set(key, { count: 1, resetAt });
    return { ok: true, remaining: config.max - 1, resetAt };
  }

  if (bucket.count >= config.max) {
    return {
      ok: false,
      retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000),
      resetAt: bucket.resetAt,
    };
  }

  bucket.count += 1;
  return {
    ok: true,
    remaining: config.max - bucket.count,
    resetAt: bucket.resetAt,
  };
}

export function reset(key: string): void {
  store.delete(key);
}

// Periodic cleanup (every 5 min)
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of store.entries()) {
      if (v.resetAt < now) store.delete(k);
    }
  }, 5 * 60_000).unref?.();
}
