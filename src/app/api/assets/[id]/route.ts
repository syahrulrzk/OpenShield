/**
 * /api/assets/[id] — Update & Delete single asset
 *
 * GET    /api/assets/[id]      get asset detail (with sanitized credentials)
 * PATCH  /api/assets/[id]      update asset fields (hostname, env, IPs, OS, status)
 * DELETE /api/assets/[id]      delete asset + cascade credentials
 *
 * OWASP A01:2021 — ownership check (404 if asset belongs to other user)
 * OWASP A02:2021 — credentials re-encrypted on update
 * OWASP A09:2021 — every mutation is audit-logged
 */

import { prisma } from "@/lib/db";
import { requireRole, PERMISSIONS } from "@/lib/security/rbac";
import { encrypt } from "@/lib/security/crypto";
import { audit } from "@/lib/security/audit";
import { z } from "zod";
import { Prisma } from "@prisma/client";

// Schema for PATCH — all fields optional, only validated fields are updated
const updateSchema = z
  .object({
    hostname: z.string().min(1).max(255).optional(),
    environment: z.enum(["PROD", "STAGING", "UAT", "DEV", "DR"]).optional(),
    displayName: z.string().max(128).nullable().optional(),
    role: z.string().max(64).nullable().optional(),
    location: z.string().max(64).nullable().optional(),
    tags: z.array(z.string().max(32)).max(16).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    publicIp: z.string().max(64).nullable().optional(),
    privateIp: z.string().max(64).nullable().optional(),
    os: z.string().max(128).nullable().optional(),
    kernel: z.string().max(128).nullable().optional(),

    // SSH fields
    sshPort: z.number().int().min(1).max(65535).optional(),
    sshUser: z.string().max(64).nullable().optional(),
    sshKey: z.string().optional(),
    sshPassword: z.string().optional(),
    sshAuthType: z.enum(["key", "password"]).optional(),

    // DB fields
    dbType: z.enum(["NONE", "POSTGRES", "MYSQL", "SQLSERVER"]).optional(),
    dbHost: z.string().max(255).nullable().optional(),
    dbPort: z.number().int().min(1).max(65535).nullable().optional(),
    dbName: z.string().max(64).nullable().optional(),
    dbUser: z.string().max(64).nullable().optional(),
    dbPassword: z.string().optional(),
  })
  .strict();

type RouteCtx = { params: Promise<{ id: string }> };

async function loadAsset(userId: string, id: string) {
  return prisma.asset.findFirst({
    where: { id, userId },
    include: { sshCredentials: true, dbCredentials: true },
  });
}

export async function GET(_req: Request, ctx: RouteCtx) {
  const auth = await requireRole(...PERMISSIONS.ASSET_READ);
  if (auth instanceof Response) return auth;

  const { id } = await ctx.params;
  const asset = await loadAsset(auth.userId, id);
  if (!asset) {
    return Response.json({ error: "Asset not found" }, { status: 404 });
  }

  // Strip encrypted credential blobs from response
  const { sshCredentials: _ssh, dbCredentials: _db, ...safe } = asset;
  return Response.json({ asset: safe });
}

export async function PATCH(req: Request, ctx: RouteCtx) {
  const auth = await requireRole(...PERMISSIONS.ASSET_WRITE);
  if (auth instanceof Response) return auth;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ua = req.headers.get("user-agent") ?? undefined;
  const { id } = await ctx.params;

  const existing = await loadAsset(auth.userId, id);
  if (!existing) {
    return Response.json({ error: "Asset not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validasi gagal", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // Hostname uniqueness check (if changed)
  if (data.hostname && data.hostname !== existing.hostname) {
    const dup = await prisma.asset.findUnique({
      where: {
        userId_hostname: { userId: auth.userId, hostname: data.hostname },
      },
    });
    if (dup) {
      return Response.json(
        { error: "Hostname sudah dipakai asset lain" },
        { status: 409 },
      );
    }
  }

  // Separate plain fields vs credential updates
  const { sshKey, sshPassword, dbPassword, tags, ...rest } = data;

  // For Json fields, Prisma needs explicit JsonNull to set NULL
  // (otherwise null is interpreted as "don't update")
  const plainFields: any = { ...rest };
  if (tags !== undefined) {
    plainFields.tags =
      tags === null ? Prisma.JsonNull : tags;
  }

  // Re-encrypt SSH credential if provided
  let sshEncData: string | null | undefined = undefined;
  if (existing.category === "SSH") {
    if (data.sshAuthType === "password" && sshPassword) {
      sshEncData = encrypt(sshPassword);
    } else if (data.sshAuthType === "key" && sshKey) {
      sshEncData = encrypt(sshKey);
    }
    // null = leave unchanged
  }

  // Re-encrypt DB credential if provided
  let dbEncData: string | null | undefined = undefined;
  if (existing.category === "DATABASE" && dbPassword) {
    dbEncData = encrypt(dbPassword);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const a = await tx.asset.update({
      where: { id },
      data: plainFields,
    });
    if (sshEncData !== undefined || dbEncData !== undefined) {
      // Lookup existing credential row by category-appropriate FK
      const whereUnique = existing.category === "SSH"
        ? { sshAssetId: id }
        : { dbAssetId: id };
      await tx.assetCredential.upsert({
        where: whereUnique,
        update: {
          ...(sshEncData !== undefined && { sshEncData }),
          ...(dbEncData !== undefined && { dbEncData }),
        },
        create: {
          sshAssetId: existing.category === "SSH" ? id : null,
          dbAssetId: existing.category === "DATABASE" ? id : null,
          sshEncData: sshEncData ?? null,
          dbEncData: dbEncData ?? null,
        },
      });
    }
    return a;
  });

  await audit({
    userId: auth.userId,
    action: "asset.update",
    resourceType: "asset",
    resourceId: id,
    ip,
    userAgent: ua,
    metadata: {
      hostname: updated.hostname,
      changedFields: Object.keys(data),
      sshChanged: sshEncData !== undefined,
      dbChanged: dbEncData !== undefined,
    },
  });

  return Response.json({ asset: updated });
}

export async function DELETE(req: Request, ctx: RouteCtx) {
  const auth = await requireRole(...PERMISSIONS.ASSET_WRITE);
  if (auth instanceof Response) return auth;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ua = req.headers.get("user-agent") ?? undefined;
  const { id } = await ctx.params;

  const existing = await loadAsset(auth.userId, id);
  if (!existing) {
    return Response.json({ error: "Asset not found" }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    // Delete asset; cascade will clean up AssetCredential rows
    // (defined in schema with onDelete: Cascade on AssetCredential.assetId)
    await tx.asset.delete({ where: { id } });
    // Manually delete related events & alerts (no cascade configured)
    await tx.sshEvent.deleteMany({ where: { assetId: id } });
    await tx.dbEvent.deleteMany({ where: { assetId: id } });
    await tx.alert.deleteMany({ where: { assetId: id } });
  });

  await audit({
    userId: auth.userId,
    action: "asset.delete",
    resourceType: "asset",
    resourceId: id,
    ip,
    userAgent: ua,
    metadata: {
      hostname: existing.hostname,
      category: existing.category,
      environment: existing.environment,
    },
  });

  return Response.json({ ok: true });
}
