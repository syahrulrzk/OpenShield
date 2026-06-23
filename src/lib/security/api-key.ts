/**
 * OpenShield — API key hashing (scrypt, no native deps)
 *
 * Format: "scrypt$N=16384$<salt-hex>$<hash-hex>"
 * Salt = 32 bytes, Hash = 64 bytes. OWASP 2023 minimums.
 *
 * Used by:
 * - POST /api/assets/[id]/api-key (generation)
 * - POST /api/ingest/apps (verification)
 */
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

const SCRYPT_N = 16384;
const SCRYPT_SALT_BYTES = 32;
const SCRYPT_HASH_BYTES = 64;

/** Generate a new API key (32 bytes random, returned as 64-char hex). */
export function generateApiKey(): string {
  return randomBytes(32).toString("hex");
}

/** Hash an API key for storage. */
export function hashApiKey(apiKey: string): string {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const hash = scryptSync(apiKey, salt, SCRYPT_HASH_BYTES, { N: SCRYPT_N });
  return `scrypt$N=${SCRYPT_N}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** Verify an API key against a stored hash. Constant-time. */
export function verifyApiKey(apiKey: string, stored: string): boolean {
  try {
    const parts = stored.split("$");
    if (parts.length !== 4 || parts[0] !== "scrypt") return false;
    const n = parseInt(parts[1].replace("N=", ""), 10);
    if (n !== SCRYPT_N) return false;
    const salt = Buffer.from(parts[2], "hex");
    const expected = Buffer.from(parts[3], "hex");
    const actual = scryptSync(apiKey, salt, expected.length, { N: n });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Extract metadata from a generated key. */
export function parseApiKey(apiKey: string): { prefix: string; last4: string } {
  return {
    prefix: apiKey.slice(0, 8),
    last4: apiKey.slice(-4),
  };
}
