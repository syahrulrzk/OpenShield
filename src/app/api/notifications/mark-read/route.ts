/**
 * /api/notifications/mark-read
 *
 * POST { ids: string[] }
 * Marks notifications as read. For "alert:*" ids, updates Alert status to ACKNOWLEDGED.
 * For "audit:*" ids, no-op (audit log is append-only).
 *
 * OWASP A01:2021 — ownership check (only alerts owned by user can be acknowledged)
 */

import { prisma } from "@/lib/db";
import { requireRole, PERMISSIONS } from "@/lib/security/rbac";
import { z } from "zod";

const schema = z.object({
  ids: z.array(z.string()).min(1).max(100),
});

export async function POST(req: Request) {
  const auth = await requireRole(...PERMISSIONS.ASSET_READ);
  if (auth instanceof Response) return auth;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }

  // Split alert vs audit ids
  const alertIds = parsed.data.ids
    .filter((id) => id.startsWith("alert:"))
    .map((id) => id.replace("alert:", ""));
  // audit:* ids are no-op (audit log is immutable)

  if (alertIds.length === 0) {
    return Response.json({ acknowledged: 0 });
  }

  // Acknowledge only OPEN alerts owned by this user
  const result = await prisma.alert.updateMany({
    where: {
      id: { in: alertIds },
      status: "OPEN",
      OR: [
        { asset: { userId: auth.userId } },
        { asset: null },
      ],
    },
    data: { status: "ACKNOWLEDGED" },
  });

  return Response.json({ acknowledged: result.count });
}
