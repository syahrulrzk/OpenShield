/**
 * OpenShield — AES-256-GCM encryption for sensitive credentials
 *
 * Used for: SSH private keys, PG connection strings, MFA secrets
 * Algorithm: AES-256-GCM (authenticated encryption)
 * Key source: ENCRYPTION_KEY env (32 bytes hex = 64 chars)
 * IV: 12 random bytes per encryption (NIST recommended)
 * Auth tag: 16 bytes, verified on decryption (tamper detection)
 *
 * Storage format: base64( iv[12] || ciphertext || authTag[16] )
 *
 * OWASP: A02:2021 Cryptographic Failures
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY must be 32 bytes hex (64 chars). Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return Buffer.from(hex, "hex");
}

/** Encrypt plaintext → base64 string */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]).toString("base64");
}

/** Decrypt base64 string → plaintext. Throws on tamper. */
export function decrypt(b64: string): string {
  const key = getKey();
  const buf = Buffer.from(b64, "base64");
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("Ciphertext too short");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const enc = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

/** Test that the encryption round-trips. Used at boot. */
export function assertCryptoWorks(): void {
  const test = "openshield-crypto-test-" + Date.now();
  const enc = encrypt(test);
  const dec = decrypt(enc);
  if (dec !== test) {
    throw new Error("Crypto self-test failed");
  }
}
