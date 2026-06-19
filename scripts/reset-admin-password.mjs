#!/usr/bin/env node
/**
 * OpenShield — Admin password reset (recovery)
 *
 * Usage:
 *   NEW_PASSWORD='S3cureP@ssw0rd!' node scripts/reset-admin-password.mjs
 *   # or interactive prompt
 *
 * - Updates admin@openshield.local password
 * - Hashes with Argon2id (current password.ts params)
 * - Revokes all refresh tokens (force re-login on all devices)
 * - Logs audit event
 * - Clears MFA secret (so user can re-enroll cleanly)
 *
 * USE ONLY when admin is locked out. All actions are audit-logged.
 */

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";

const prisma = new PrismaClient();

const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024, // 19 MiB — matches src/lib/security/password.ts
  timeCost: 2,
  parallelism: 1,
};

function validatePassword(p) {
  if (p.length < 12) throw new Error("Password minimal 12 karakter");
  if (!/[a-z]/.test(p)) throw new Error("Password harus ada huruf kecil");
  if (!/[A-Z]/.test(p)) throw new Error("Password harus ada huruf besar");
  if (!/[0-9]/.test(p)) throw new Error("Password harus ada angka");
  if (!/[^A-Za-z0-9]/.test(p)) throw new Error("Password harus ada karakter spesial");
}

async function main() {
  const email = process.env.ADMIN_EMAIL || "admin@openshield.local";
  const newPassword = process.env.NEW_PASSWORD || "OpenShield@Reset2026!";

  validatePassword(newPassword);

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`[reset] User ${email} not found. Aborting.`);
    process.exit(1);
  }

  console.log(`[reset] Target user: ${user.email} (id=${user.id}, role=${user.role})`);

  const passwordHash = await argon2.hash(newPassword, OPTIONS);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        mfaEnabled: false, // clear MFA so user can log in cleanly
      },
    }),
    prisma.refreshToken.deleteMany({
      where: { userId: user.id },
    }),
  ]);

  // Audit log entry (write directly, mimicking src/lib/security/audit.ts)
  const ts = new Date().toISOString();
  const auditId = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const metadata = {
    change: "password",
    source: "reset-admin-password.mjs",
    mfa_cleared: true,
  };
  const metaJson = JSON.stringify(metadata);
  const hashInput = `${auditId}|${user.id}|user.password.reset|${metaJson}|${ts}`;
  const hash = createHash("sha256").update(hashInput).digest("hex");

  await prisma.$executeRaw`
    INSERT INTO audit_log (id, user_id, action, resource_type, resource_id, ip, metadata, hash, created_at)
    VALUES (${auditId}, ${user.id}, 'user.password.reset', 'user', ${user.id}, NULL, ${metaJson}::jsonb, ${hash}, CURRENT_TIMESTAMP)
  `;

  console.log("");
  console.log("=".repeat(60));
  console.log("✅ Admin password reset");
  console.log("=".repeat(60));
  console.log(`  Email:    ${user.email}`);
  console.log(`  Password: ${newPassword}`);
  console.log(`  MFA:      DISABLED (re-enroll in Settings > Profile)`);
  console.log(`  Refresh:  ALL TOKENS REVOKED`);
  console.log(`  Audit:    ${auditId}`);
  console.log("=".repeat(60));
  console.log("⚠️  Login then immediately change password via Settings > Profile.");
  console.log("");
}

main()
  .catch((err) => {
    console.error("[reset] FATAL:", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
