/**
 * /api/assets/[id]/api-key — Generate / regenerate / clear API key for an APP asset
 *
 * POST   /api/assets/[id]/api-key   Generate new key (returns plaintext ONCE)
 * DELETE /api/assets/[id]/api-key   Clear existing key
 *
 * Auth: OWNER or ADMIN
 * Audit: asset.api_key.created | asset.api_key.cleared
 *
 * The plaintext key is returned ONLY in the POST response. After that it's
 * gone forever — only the scrypt hash is stored. Caller must copy it to a
 * safe location immediately.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/security/rbac";
import { audit } from "@/lib/security/audit";
import {
  generateApiKey,
  hashApiKey,
  parseApiKey,
} from "@/lib/security/api-key";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireRole("OWNER", "ADMIN");
  if (session instanceof NextResponse) return session;

  const { id } = await params;
  const existing = await prisma.asset.findFirst({
    where: { id, userId: session.userId },
    select: { id: true, displayName: true, category: true, apiKeyPrefix: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }
  if (existing.category !== "APP") {
    return NextResponse.json(
      { error: "API keys are only supported for APP category assets" },
      { status: 400 }
    );
  }

  // Parse optional body for confirm prompt
  let body: { confirm?: string } = {};
  try {
    body = (await req.json()) as { confirm?: string };
  } catch {
    body = {};
  }
  // If a key already exists, require explicit "regenerate" confirmation
  if (existing.apiKeyPrefix) {
    const schema = z.object({ confirm: z.literal("regenerate") });
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            "This app already has an API key. Pass {\"confirm\":\"regenerate\"} to generate a new one (the old key will be invalidated).",
        },
        { status: 409 }
      );
    }
  }

  // Generate new key
  const apiKey = generateApiKey();
  const { prefix, last4 } = parseApiKey(apiKey);
  const hash = hashApiKey(apiKey);

  const updated = await prisma.asset.update({
    where: { id },
    data: {
      apiKeyHash: hash,
      apiKeyPrefix: prefix,
      apiKeyLast4: last4,
      apiKeyCreatedAt: new Date(),
      apiKeyLastUsedAt: null,
    },
    select: {
      id: true,
      displayName: true,
      apiKeyPrefix: true,
      apiKeyLast4: true,
      apiKeyCreatedAt: true,
    },
  });

  await audit({
    userId: session.userId,
    action: "asset.api_key.created",
    resourceType: "asset",
    resourceId: id,
    metadata: {
      displayName: updated.displayName,
      prefix,
      last4,
      regenerated: existing.apiKeyPrefix !== null,
    },
    ip: req.headers.get("x-forwarded-for") ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });

  return NextResponse.json({
    ok: true,
    asset: updated,
    // ⚠️ Plaintext key returned ONCE — caller must copy immediately
    apiKey,
    webhookUrl: `${getBaseUrl(req)}/api/ingest/apps`,
    instructions:
      "Copy this key now — it will not be shown again. Send it as X-API-Key header to POST /api/ingest/apps.",
  });
}

/** Extract base URL from request, preferring X-Forwarded-Host for proxied setups. */
function getBaseUrl(req: NextRequest): string {
  const proto =
    req.headers.get("x-forwarded-proto") ??
    (req.nextUrl.protocol.replace(":", ""));
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  return `${proto}://${host}`;
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireRole("OWNER", "ADMIN");
  if (session instanceof NextResponse) return session;

  const { id } = await params;
  const existing = await prisma.asset.findFirst({
    where: { id, userId: session.userId },
    select: { id: true, displayName: true, category: true, apiKeyPrefix: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }
  if (existing.category !== "APP") {
    return NextResponse.json(
      { error: "API keys are only supported for APP category assets" },
      { status: 400 }
    );
  }
  if (!existing.apiKeyPrefix) {
    return NextResponse.json(
      { error: "No API key to clear" },
      { status: 404 }
    );
  }

  const updated = await prisma.asset.update({
    where: { id },
    data: {
      apiKeyHash: null,
      apiKeyPrefix: null,
      apiKeyLast4: null,
      apiKeyCreatedAt: null,
    },
    select: { id: true, displayName: true },
  });

  await audit({
    userId: session.userId,
    action: "asset.api_key.cleared",
    resourceType: "asset",
    resourceId: id,
    metadata: { displayName: updated.displayName, clearedPrefix: existing.apiKeyPrefix },
    ip: req.headers.get("x-forwarded-for") ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });

  return NextResponse.json({ ok: true, asset: updated });
}
