/**
 * /api/auth/me
 * GET → { userId, email, role, exp } (decoded from os_access JWT, no DB hit)
 *
 * Used by client to know when to auto-refresh the access token.
 */

import { getSession } from "@/lib/security/rbac";
import { verifyAccessToken } from "@/lib/security/jwt";
import { cookies } from "next/headers";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Decode exp from raw token (no extra verify — getSession() already did it)
  const cookieStore = await cookies();
  const token = cookieStore.get("os_access")?.value;
  if (!token) {
    return Response.json({ error: "No token" }, { status: 401 });
  }

  try {
    const claims = await verifyAccessToken(token);
    return Response.json({
      userId: claims.sub,
      email: claims.email,
      role: claims.role,
      exp: claims.exp, // unix seconds
      now: Math.floor(Date.now() / 1000),
    });
  } catch {
    return Response.json({ error: "Invalid token" }, { status: 401 });
  }
}