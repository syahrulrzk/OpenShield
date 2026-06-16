/**
 * /api/auth/me
 * GET → { user } | 401
 */

import { getSession } from "@/lib/security/rbac";

export async function GET() {
  const s = await getSession();
  if (!s) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({
    user: { id: s.userId, email: s.email, role: s.role },
  });
}
