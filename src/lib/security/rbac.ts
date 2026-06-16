/**
 * OpenShield — RBAC (Role-Based Access Control)
 *
 * Roles: OWNER (full), ADMIN (manage assets/alerts), VIEWER (read-only)
 * All API endpoints must call `requireRole()` or `requireOwnership()`.
 *
 * OWASP A01:2021 — explicit permission check, deny by default
 */

import { verifyAccessToken } from "./jwt";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export type UserRole = "OWNER" | "ADMIN" | "VIEWER";

export type Session = {
  userId: string;
  email: string;
  role: UserRole;
};

/** Get current session from cookie. Returns null if not authenticated. */
export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("os_access")?.value;
  if (!token) return null;
  try {
    const claims = await verifyAccessToken(token);
    return {
      userId: claims.sub,
      email: claims.email,
      role: claims.role as UserRole,
    };
  } catch {
    return null;
  }
}

/** Require authenticated session. Returns 401 response if not. */
export async function requireAuth(): Promise<Session | NextResponse> {
  const s = await getSession();
  if (!s) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return s;
}

/** Require specific role(s). Returns 403 if insufficient. */
export async function requireRole(...allowed: UserRole[]): Promise<Session | NextResponse> {
  const s = await requireAuth();
  if (s instanceof NextResponse) return s;
  if (!allowed.includes(s.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return s;
}

export const PERMISSIONS = {
  ASSET_READ: ["OWNER", "ADMIN", "VIEWER"] as UserRole[],
  ASSET_WRITE: ["OWNER", "ADMIN"] as UserRole[],
  ASSET_DELETE: ["OWNER", "ADMIN"] as UserRole[],
  ALERT_RESOLVE: ["OWNER", "ADMIN"] as UserRole[],
  USER_READ: ["OWNER", "ADMIN"] as UserRole[],
  USER_WRITE: ["OWNER", "ADMIN"] as UserRole[],
  USER_MANAGE: ["OWNER"] as UserRole[],
  SETTINGS_READ: ["OWNER", "ADMIN"] as UserRole[],
  SETTINGS_WRITE: ["OWNER", "ADMIN"] as UserRole[],
  AUDIT_READ: ["OWNER"] as UserRole[],
} as const;
