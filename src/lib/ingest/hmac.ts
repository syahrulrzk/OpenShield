/**
 * OpenShield — HMAC-SHA256 signing for internal service-to-service auth
 *
 * Used by: the central poller (running in /api/poller) → /api/events/ingest
 * Purpose: prevent external actors from posting fake events to ingest
 *
 * Header format: X-Openshield-Signature: sha256=<hex>
 * Body: raw request body bytes (UTF-8)
 *
 * Key source: INGEST_HMAC_SECRET env (shared between poller and ingest endpoint)
 * Rotation: bump KEY_VERSION in header for key rotation support
 *
 * OWASP A07:2021 — Identification and Authentication Failures
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Sign a body with the shared secret. Returns "sha256=<hex>".
 * Used by the poller before POSTing to /api/events/ingest.
 */
export function signBody(secret: string, body: string): string {
  if (!secret || secret.length < 16) {
    throw new Error("INGEST_HMAC_SECRET must be set (min 16 chars)");
  }
  const h = createHmac("sha256", secret);
  h.update(body, "utf8");
  return "sha256=" + h.digest("hex");
}

/**
 * Verify a signature against the body. Uses timing-safe compare to prevent
 * timing attacks. Returns false on any mismatch (length, format, hash).
 */
export function verifySignature(
  secret: string,
  body: string,
  header: string | null
): boolean {
  if (!header || !secret) return false;
  if (!header.startsWith("sha256=")) return false;

  const expected = signBody(secret, body);
  if (header.length !== expected.length) return false;

  try {
    return timingSafeEqual(
      Buffer.from(header, "utf8"),
      Buffer.from(expected, "utf8")
    );
  } catch {
    return false;
  }
}

/**
 * Read the shared secret from env. Throws if not configured.
 * Cached after first call to avoid repeated env lookups in hot loops.
 */
let cachedSecret: string | null = null;
export function getIngestSecret(): string {
  if (cachedSecret) return cachedSecret;
  const s = process.env.INGEST_HMAC_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "INGEST_HMAC_SECRET not configured. Set in .env (min 16 chars). " +
        "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  cachedSecret = s;
  return s;
}
