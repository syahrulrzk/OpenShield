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
    hostname: z.string().min(1).max(255),
    sshUser: z.string().max(64).optional(),
    sshPort: z.number().int().min(1).max(65535).default(22),
    sshKey: z.string().optional(),
    sshPassword: z.string().optional(),
    sshAuthType: z.enum(["key", "password"]).default("key"),

    // Database type (POSTGRES | MYSQL | SQLSERVER | NONE)
    dbType: z.enum(["NONE", "POSTGRES", "MYSQL", "SQLSERVER"]).default("NONE"),
    dbHost: z.string().max(255).optional(),
    dbPort: z.number().int().min(1).max(65535).optional(),
    dbName: z.string().max(64).optional(),
    dbUser: z.string().max(64).optional(),
    dbPassword: z.string().optional(),
  })
  .refine(
    (d) =>
      d.dbType === "NONE" ||
      (d.dbHost && d.dbName && d.dbUser && d.dbPassword),
    { message: "DB credentials incomplete", path: ["dbPassword"] }
  );

export async function GET() {
  const auth = await requireRole(...PERMISSIONS.ASSET_READ);
  if (auth instanceof Response) return auth;

  const assets = await prisma.asset.findMany({
    where: { userId: auth.userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      hostname: true,
      publicIp: true,
      privateIp: true,
      os: true,
      kernel: true,
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

  if (data.sshUser && !data.sshKey && !data.sshPassword) {
    return Response.json({ error: "SSH user tanpa key/password" }, { status: 400 });
  }

  const existing = await prisma.asset.findUnique({
    where: { userId_hostname: { userId: auth.userId, hostname: data.hostname } },
  });
  if (existing) {
    return Response.json({ error: "Hostname sudah ada" }, { status: 409 });
  }

  // Encrypt SSH credential
  const sshEncData =
    data.sshAuthType === "key" && data.sshKey
      ? encrypt(data.sshKey)
      : data.sshAuthType === "password" && data.sshPassword
        ? encrypt(data.sshPassword)
        : null;

  // Encrypt DB credential (we store just the password — other details are on the asset row)
  const dbEncData =
    data.dbType !== "NONE" && data.dbPassword ? encrypt(data.dbPassword) : null;

  const asset = await prisma.$transaction(async (tx) => {
    const a = await tx.asset.create({
      data: {
        userId: auth.userId,
        hostname: data.hostname,
        sshPort: data.sshPort,
        sshUser: data.sshUser,
        dbType: data.dbType,
        dbHost: data.dbType !== "NONE" ? data.dbHost : null,
        dbPort: data.dbType !== "NONE" ? data.dbPort : null,
        dbName: data.dbType !== "NONE" ? data.dbName : null,
        dbUser: data.dbType !== "NONE" ? data.dbUser : null,
        status: "PENDING",
      },
    });
    if (sshEncData || dbEncData) {
      await tx.assetCredential.create({
        data: {
          assetId: a.id,
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
      ssh: !!sshEncData,
      dbType: data.dbType,
    },
  });

  return Response.json({ asset }, { status: 201 });
}
