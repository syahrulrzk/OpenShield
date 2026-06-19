#!/usr/bin/env node
/**
 * OpenShield — Admin OWNER seed script
 *
 * Usage:
 *   DATABASE_URL="postgresql://openshield:PASS@127.0.0.1:5433/openshield?schema=public" \
 *     node scripts/seed-admin.mjs
 *
 * Default credentials:
 *   Email:    admin@openshield.local
 *   Password: Admin@OpenShield2026!
 *
 * IMPORTANT: Change the password immediately after first login (Settings > Profile).
 */

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@openshield.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASS
  || process.env.ADMIN_PASSWORD
  || "Admin@OpenShield2026!";
const ADMIN_NAME = process.env.ADMIN_NAME || "Syahrul Rizki (Owner)";

function validatePassword(p) {
  if (p.length < 12) throw new Error("Password minimal 12 karakter");
  if (!/[a-z]/.test(p)) throw new Error("Password harus ada huruf kecil");
  if (!/[A-Z]/.test(p)) throw new Error("Password harus ada huruf besar");
  if (!/[0-9]/.test(p)) throw new Error("Password harus ada angka");
  if (!/[^A-Za-z0-9]/.test(p)) throw new Error("Password harus ada karakter spesial");
}

async function main() {
  validatePassword(ADMIN_PASSWORD);

  const existing = await prisma.user.findUnique({
    where: { email: ADMIN_EMAIL },
  });

  if (existing) {
    console.log(`[seed] User ${ADMIN_EMAIL} sudah ada (id=${existing.id}). Skip insert.`);
    console.log("[seed] Untuk reset password, gunakan Settings > Profile atau hapus user dulu.");
    return;
  }

  const passwordHash = await argon2.hash(ADMIN_PASSWORD, OPTIONS);

  const user = await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      passwordHash,
      name: ADMIN_NAME,
      role: "OWNER",
      isActive: true,
    },
  });

  console.log("");
  console.log("=".repeat(60));
  console.log("✅ Admin OWNER created");
  console.log("=".repeat(60));
  console.log(`  Email:    ${user.email}`);
  console.log(`  Name:     ${user.name}`);
  console.log(`  Role:     ${user.role}`);
  console.log(`  Password: ${ADMIN_PASSWORD}`);
  console.log(`  ID:       ${user.id}`);
  console.log("=".repeat(60));
  console.log("⚠️  Ganti password segera setelah login pertama!");
  console.log("");
}

main()
  .catch((err) => {
    console.error("[seed] FATAL:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
