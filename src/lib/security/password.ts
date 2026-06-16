/**
 * OpenShield — Argon2id password hashing
 *
 * OWASP A02:2021 — uses Argon2id (memory-hard, side-channel resistant)
 * Parameters: m=19MiB, t=2, p=1 (OWASP minimum recommendation for Argon2id)
 *
 * Password policy (enforced separately in validators):
 * - Min 12 chars
 * - Must contain: upper, lower, digit, special
 */

import argon2 from "argon2";

const OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < 12) {
    throw new Error("Password must be at least 12 characters");
  }
  return argon2.hash(plain, OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** Password policy validator — throws on weak passwords */
export function validatePassword(plain: string): { ok: true } | { ok: false; reason: string } {
  if (plain.length < 12) return { ok: false, reason: "Password minimal 12 karakter" };
  if (!/[a-z]/.test(plain)) return { ok: false, reason: "Password harus ada huruf kecil" };
  if (!/[A-Z]/.test(plain)) return { ok: false, reason: "Password harus ada huruf besar" };
  if (!/[0-9]/.test(plain)) return { ok: false, reason: "Password harus ada angka" };
  if (!/[^A-Za-z0-9]/.test(plain)) return { ok: false, reason: "Password harus ada karakter spesial" };
  return { ok: true };
}
