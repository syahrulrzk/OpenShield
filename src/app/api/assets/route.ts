/**
 * /api/assets — CRUD
 *
 * GET  /api/assets           list user's assets
 * POST /api/assets           create asset (with credentials, encrypted)
 *
 * OWASP A01:2021 — ownership check on every read/mutate
 * OWASP A02:2021 — credentials encrypted with AES-256-GCM
 * OWASP A09:2021 — audit logged
 */

import { prisma } from "@/lib/db";
import { requireRole, PERMISSIONS } from "@/lib/security/rbac";
import { encrypt } from "@/lib/security/crypto";
import { audit } from "@/lib/security/audit";
import { z } from "zod";

const createSchema = z
  .object({
    // Top-level category: SSH | DATABASE | APP (APP not yet supported)
    category: z.enum(["SSH", "DATABASE", "APP"]).default("SSH"),
    // Deployment environment
    environment: z.enum(["PROD", "STAGING", "UAT", "DEV", "DR"]).default("PROD"),

    // ===== IDENTITAS SERVER =====
    // displayName: alias manusiawi, mis. "prod-web-jkt-01"
    // Optional — kalau kosong akan di-generate dari hostname
    displayName: z.string().max(128).optional(),
    hostname: z.string().min(1).max(255),

    // Network & system info (opsional, bisa diisi belakangan via edit)
    publicIp: z.string().max(64).optional(),
    privateIp: z.string().max(64).optional(),
    os: z.string().max(128).optional(),
    kernel: z.string().max(128).optional(),

    // SSH fields
    sshUser: z.string().max(64).optional(),
    sshPort: z.number().int().min(1).max(65535).default(22),
    sshKey: z.string().optional(),
    sshPassword: z.string().optional(),
    sshAuthType: z.enum(["key", "password"]).default("key"),

    // DB sub-type (only required when category = DATABASE)
    dbType: z.enum(["NONE", "POSTGRES", "MYSQL", "SQLSERVER"]).default("NONE"),
    dbHost: z.string().max(255).optional(),
    dbPort: z.number().int().min(1).max(65535).optional(),
    dbName: z.string().max(64).optional(),
    dbUser: z.string().max(64).optional(),
    dbPassword: z.string().optional(),
  })
  .refine(
    (d) => d.category !== "APP",
    { message: "Akses Apps belum tersedia", path: ["category"] },
  )
  .refine(
    (d) =>
      d.category !== "DATABASE" ||
      (d.dbType !== "NONE" && d.dbHost && d.dbName && d.dbUser && d.dbPassword),
    { message: "DB credentials incomplete", path: ["dbPassword"] },
  )
  .refine(
    (d) =>
      d.category !== "SSH" ||
      !d.sshUser ||
      d.sshKey ||
      d.sshPassword,
    { message: "SSH user tanpa key/password", path: ["sshKey"] },
  );

export async function GET(req: Request) {
  const auth = await requireRole(...PERMISSIONS.ASSET_READ);
  if (auth instanceof Response) return auth;

  // Optional ?category=SSH|DATABASE|APP filter
  const url = new URL(req.url);
  const cat = url.searchParams.get("category");
  const env = url.searchParams.get("environment");
  const where: any = { userId: auth.userId };
  if (cat && ["SSH", "DATABASE", "APP"].includes(cat)) {
    where.category = cat;
  }
  if (env && ["PROD", "STAGING", "UAT", "DEV", "DR"].includes(env)) {
    where.environment = env;
  }

  const assets = await prisma.asset.findMany({
    where,
    orderBy: [{ environment: "asc" }, { displayName: "asc" }, { hostname: "asc" }],
    select: {
      id: true,
      category: true,
      environment: true,
      displayName: true,
      role: true,
      location: true,
      tags: true,
      description: true,
      hostname: true,
      publicIp: true,
      privateIp: true,
      os: true,
      kernel: true,
      sshPort: true,
      sshUser: true,
      dbType: true,
      dbHost: true,
      dbPort: true,
      dbName: true,
      dbUser: true,
      status: true,
      lastSeenAt: true,
      createdAt: true,
    },
  });
  return Response.json({ assets });
}

export async function POST(req: Request) {
  const auth = await requireRole(...PERMISSIONS.ASSET_WRITE);
  if (auth instanceof Response) return auth;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ua = req.headers.get("user-agent") ?? undefined;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validasi gagal", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const data = parsed.data;

  const existing = await prisma.asset.findUnique({
    where: { userId_hostname: { userId: auth.userId, hostname: data.hostname } },
  });
  if (existing) {
    return Response.json({ error: "Hostname sudah ada" }, { status: 409 });
  }

  // Display name uniqueness check (kalau diisi manual)
  const finalDisplayName = data.displayName?.trim() || data.hostname;
  if (data.displayName?.trim()) {
    const dup = await prisma.asset.findUnique({
      where: { userId_displayName: { userId: auth.userId, displayName: finalDisplayName } },
    });
    if (dup) {
      return Response.json(
        { error: `Display name "${finalDisplayName}" sudah dipakai asset lain` },
        { status: 409 }
      );
    }
  }

  // Encrypt SSH credential
  const sshEncData =
    data.category === "SSH" && data.sshAuthType === "key" && data.sshKey
      ? encrypt(data.sshKey)
      : data.category === "SSH" && data.sshAuthType === "password" && data.sshPassword
        ? encrypt(data.sshPassword)
        : null;

  // Encrypt DB credential
  const dbEncData =
    data.category === "DATABASE" && data.dbPassword
      ? encrypt(data.dbPassword)
      : null;

  const asset = await prisma.$transaction(async (tx) => {
    const a = await tx.asset.create({
      data: {
        userId: auth.userId,
        category: data.category,
        environment: data.environment,
        displayName: finalDisplayName,
        publicIp: data.publicIp?.trim() || null,
        privateIp: data.privateIp?.trim() || null,
        os: data.os?.trim() || null,
        kernel: data.kernel?.trim() || null,
        hostname: data.hostname,
        sshPort: data.category === "DATABASE" ? 22 : data.sshPort,
        sshUser: data.category === "DATABASE" ? null : data.sshUser,
        dbType: data.category === "DATABASE" ? data.dbType : "NONE",
        dbHost: data.category === "DATABASE" ? data.dbHost : null,
        dbPort: data.category === "DATABASE" ? data.dbPort : null,
        dbName: data.category === "DATABASE" ? data.dbName : null,
        dbUser: data.category === "DATABASE" ? data.dbUser : null,
        status: "PENDING",
      },
    });
    if (sshEncData || dbEncData) {
      await tx.assetCredential.create({
        data: {
          // AssetCredential sekarang punya dua slot FK terpisah.
          // SSH asset → sshAssetId, DB asset → dbAssetId.
          sshAssetId: data.category === "SSH" ? a.id : null,
          dbAssetId: data.category === "DATABASE" ? a.id : null,
          sshEncData,
          dbEncData,
        },
      });
    }
    return a;
  });

  await audit({
    userId: auth.userId,
    action: "asset.create",
    resourceType: "asset",
    resourceId: asset.id,
    ip,
    userAgent: ua,
    metadata: {
      hostname: data.hostname,
      displayName: finalDisplayName,
      category: data.category,
      environment: data.environment,
      ssh: !!sshEncData,
      dbType: data.dbType,
    },
  });

  return Response.json({ asset }, { status: 201 });
}
