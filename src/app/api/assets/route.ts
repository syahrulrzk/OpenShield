/**
 * /api/assets — Asset CRUD
 *
 * POST /api/assets
 *   Body: {
 *     displayName: string         — required, 1-64 chars
 *     environment: "PROD"|"STAGING"|"UAT"  — required (no DEV/DR yet)
 *     category: "SSH" | "DATABASE" — required
 *     dbType?: "POSTGRES"|"MYSQL"|"SQLSERVER"  — required if DATABASE
 *     dbHost?: string              — required if DATABASE
 *     dbPort?: number              — required if DATABASE
 *     dbName?: string              — required if DATABASE (default db)
 *     dbUser?: string              — required if DATABASE
 *     password?: string            — required if DATABASE (will be encrypted)
 *     hostname?: string            — required (used for both SSH & DB)
 *     role?: string                — optional
 *     location?: string            — optional
 *     description?: string         — optional
 *     tags?: string[]              — optional
 *     testConnection?: boolean     — default true. Pings DB to verify creds.
 *   }
 *   Response: { ok: true, asset: { id, displayName, ... } }
 *           | { ok: false, error: string, details?: string }
 *
 * Auth: OWNER or ADMIN
 * Audit: asset.create, credential.create, asset.test_connection
 *
 * For DATABASE assets, the provided password is encrypted via AES-256-GCM
 * and stored in AssetCredential.dbEncData. Original password is never
 * returned in the response.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/security/rbac";
import { audit } from "@/lib/security/audit";
import { encrypt } from "@/lib/security/crypto";
import { pollDatabase } from "@/lib/poller/db";

const createSchema = z
  .object({
    displayName: z.string().trim().min(1).max(64),
    environment: z.enum(["PROD", "STAGING", "UAT"]),
    category: z.enum(["SSH", "DATABASE"]),
    // Database-specific
    dbType: z.enum(["POSTGRES", "MYSQL", "SQLSERVER"]).optional(),
    dbHost: z.string().trim().min(1).max(255).optional(),
    dbPort: z.number().int().min(1).max(65535).optional(),
    dbName: z.string().trim().min(1).max(64).optional(),
    dbUser: z.string().trim().min(1).max(64).optional(),
    password: z.string().min(1).max(512).optional(),
    // Required hostname (used for both SSH and DB; we generate dbName from displayName)
    hostname: z.string().trim().min(1).max(255).optional(),
    // Optional metadata
    role: z.string().trim().max(64).optional(),
    location: z.string().trim().max(128).optional(),
    description: z.string().trim().max(512).optional(),
    tags: z.array(z.string().trim().min(1).max(32)).max(16).optional(),
    testConnection: z.boolean().optional().default(true),
  })
  .refine(
    (d) => {
      // If DATABASE, require dbType, dbHost, dbPort, dbName, dbUser, password
      if (d.category === "DATABASE") {
        return (
          !!d.dbType &&
          !!d.dbHost &&
          d.dbPort !== undefined &&
          !!d.dbName &&
          !!d.dbUser &&
          !!d.password
        );
      }
      return true;
    },
    {
      message:
        "DATABASE assets require: dbType, dbHost, dbPort, dbName, dbUser, password",
    }
  );

export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof NextResponse) return session;
  if (session.role !== "OWNER" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }
  const data = parsed.data;

  // Hostname: required, used as display identity
  // For DB: use displayName-sanitized version
  // For SSH: use provided or displayName
  const hostname =
    data.hostname ??
    (data.category === "DATABASE"
      ? `${data.displayName.toLowerCase().replace(/[^a-z0-9-]/g, "-")}.db.local`
      : data.displayName);

  // Displayname uniqueness (per user)
  const existing = await prisma.asset.findFirst({
    where: {
      userId: session.userId,
      OR: [{ displayName: data.displayName }, { hostname }],
    },
    select: { id: true, displayName: true, hostname: true },
  });
  if (existing) {
    return NextResponse.json(
      {
        error: existing.displayName === data.displayName
          ? `Asset displayName "${data.displayName}" already exists`
          : `Asset hostname "${hostname}" already exists`,
      },
      { status: 409 }
    );
  }

  // Default ports by DB type
  const DEFAULT_PORTS: Record<string, number> = {
    POSTGRES: 5432,
    MYSQL: 3306,
    SQLSERVER: 1433,
  };
  const finalPort =
    data.dbPort ?? (data.dbType ? DEFAULT_PORTS[data.dbType] : 0);

  // Test connection if DATABASE + testConnection = true
  if (data.category === "DATABASE" && data.testConnection) {
    const result = await pollDatabase({
      dbType: data.dbType as "POSTGRES" | "MYSQL" | "SQLSERVER",
      host: data.dbHost!,
      port: finalPort,
      user: data.dbUser!,
      password: data.password!,
      database: data.dbName!,
    });
    if (!result.ok) {
      await audit({
        userId: session.userId,
        action: "asset.test_connection",
        resourceType: "asset",
        metadata: {
          displayName: data.displayName,
          dbType: data.dbType,
          dbHost: data.dbHost,
          ok: false,
          error: result.error,
        },
        ip: req.headers.get("x-forwarded-for") ?? undefined,
        userAgent: req.headers.get("user-agent") ?? undefined,
      });
      return NextResponse.json(
        {
          ok: false,
          error: "Connection test failed",
          details: result.error,
        },
        { status: 400 }
      );
    }
  }

  // Encrypt credential (DATABASE only)
  let dbEncData: string | undefined;
  if (data.category === "DATABASE" && data.password) {
    try {
      dbEncData = encrypt(
        JSON.stringify({
          user: data.dbUser!,
          password: data.password!,
        })
      );
    } catch (err) {
      return NextResponse.json(
        { error: "Failed to encrypt credentials", details: String(err) },
        { status: 500 }
      );
    }
  }

  // Create Asset (+ AssetCredential in same create)
  let asset;
  try {
    asset = await prisma.asset.create({
      data: {
        userId: session.userId,
        category: data.category,
        environment: data.environment,
        displayName: data.displayName,
        hostname,
        role: data.role ?? null,
        location: data.location ?? null,
        description: data.description ?? null,
        tags: data.tags ?? [],
        // Database-specific
        dbType: data.dbType ?? "NONE",
        dbHost: data.dbHost ?? null,
        dbPort: data.category === "DATABASE" ? finalPort : null,
        dbName: data.dbName ?? null,
        dbUser: data.dbUser ?? null,
        // Start as PENDING — poller will set ONLINE after first successful poll
        status: "PENDING",
        ...(dbEncData
          ? {
              dbCredentials: {
                create: {
                  dbEncData,
                },
              },
            }
          : {}),
      },
      select: {
        id: true,
        displayName: true,
        category: true,
        environment: true,
        hostname: true,
        dbType: true,
        dbHost: true,
        dbPort: true,
        dbName: true,
        dbUser: true,
        status: true,
        createdAt: true,
      },
    });
  } catch (err) {
    console.error("Asset create failed:", err);
    return NextResponse.json(
      { error: "Failed to create asset", details: String(err) },
      { status: 500 }
    );
  }

  // Audit logs
  await audit({
    userId: session.userId,
    action: "asset.create",
    resourceType: "asset",
    resourceId: asset.id,
    metadata: {
      displayName: asset.displayName,
      category: asset.category,
      environment: asset.environment,
      dbType: asset.dbType,
      dbHost: asset.dbHost,
      dbPort: asset.dbPort,
      dbName: asset.dbName,
      dbUser: asset.dbUser,
      hostname: asset.hostname,
    },
    ip: req.headers.get("x-forwarded-for") ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  if (dbEncData) {
    await audit({
      userId: session.userId,
      action: "credential.create",
      resourceType: "asset_credential",
      resourceId: asset.id,
      metadata: { displayName: asset.displayName, encrypted: true },
      ip: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
  }

  return NextResponse.json({ ok: true, asset });
}

/** GET /api/assets — list assets (for UI + selectors) */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof NextResponse) return session;

  const url = new URL(req.url);
  const category = url.searchParams.get("category")?.toUpperCase();
  const dbType = url.searchParams.get("dbType")?.toUpperCase();

  const where: Record<string, unknown> = { userId: session.userId };
  if (category === "SSH" || category === "DATABASE") where.category = category;
  if (dbType === "POSTGRES" || dbType === "MYSQL" || dbType === "SQLSERVER") {
    where.dbType = dbType;
  }

  const assets = await prisma.asset.findMany({
    where,
    select: {
      id: true,
      displayName: true,
      category: true,
      environment: true,
      hostname: true,
      role: true,
      location: true,
      dbType: true,
      dbHost: true,
      dbPort: true,
      dbName: true,
      dbUser: true,
      status: true,
      tags: true,
      description: true,
      createdAt: true,
      updatedAt: true,
      // NEVER select dbEncData or sshEncData in list view (sensitive)
    },
    orderBy: [{ category: "asc" }, { displayName: "asc" }],
  });

  return NextResponse.json({ ok: true, assets });
}
