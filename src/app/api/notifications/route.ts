/**
 * /api/notifications
 *
 * Derives notifications from existing data sources (no new model needed):
 *  - OPEN alerts (severity-ordered)
 *  - Recent user audit log entries (auth, asset, user actions)
 *
 * Each notification has: id, type ("alert" | "audit"), title, description,
 * severity, action ("acknowledge_alert" for OPEN alerts, null otherwise),
 * read (false → unread), createdAt.
 *
 * Mark as read: POST /api/notifications/mark-read { ids: string[] }
 *
 * OWASP A01:2021 — ownership check via session.userId
 */

import { prisma } from "@/lib/db";
import { requireRole, PERMISSIONS } from "@/lib/security/rbac";
import { NextRequest } from "next/server";

type NotificationItem = {
  id: string;
  type: "alert" | "audit";
  title: string;
  description: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "INFO";
  action: "acknowledge_alert" | null;
  resourceId: string | null;
  createdAt: string;
};

export async function GET(req: NextRequest) {
  const auth = await requireRole(...PERMISSIONS.ASSET_READ);
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);

  // Fetch OPEN alerts for this user's assets
  const openAlerts = await prisma.alert.findMany({
    where: {
      status: "OPEN",
      OR: [
        { asset: { userId: auth.userId } },
        { asset: null }, // system-level alerts
      ],
    },
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      id: true,
      title: true,
      description: true,
      severity: true,
      createdAt: true,
      assetId: true,
    },
  });

  // Fetch recent audit log entries for this user
  const recentAudit = await prisma.auditLog.findMany({
    where: { userId: auth.userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      action: true,
      resourceType: true,
      resourceId: true,
      metadata: true,
      ip: true,
      userAgent: true,
      createdAt: true,
    },
  });

  // Map audit log → notifications (filter to relevant actions)
  const AUDIT_NOTIFY_ACTIONS = new Set([
    "auth.login.success",
    "auth.login.failed",
    "asset.create",
    "asset.delete",
    "user.create",
    "user.delete",
    "user.update",
    "settings.update",
    "credential.view",
  ]);

  const auditItems: NotificationItem[] = recentAudit
    .filter((a) => AUDIT_NOTIFY_ACTIONS.has(a.action))
    .map((a) => {
      const meta = (a.metadata as Record<string, any>) || {};
      let title = a.action;
      let description = "";
      let severity: NotificationItem["severity"] = "INFO";

      switch (a.action) {
        case "auth.login.success":
          title = "Login berhasil";
          description = `Dari IP ${a.ip ?? "unknown"} · ${a.userAgent?.slice(0, 40) ?? "browser"}`;
          severity = "LOW";
          break;
        case "auth.login.failed":
          title = "Login gagal";
          description = `Dari IP ${a.ip ?? "unknown"} — kemungkinan brute force`;
          severity = "MEDIUM";
          break;
        case "asset.create":
          title = "Asset baru ditambahkan";
          description = `${meta.hostname ?? a.resourceId} · kategori ${meta.category ?? "?"}`;
          severity = "INFO";
          break;
        case "asset.delete":
          title = "Asset dihapus";
          description = `${meta.hostname ?? a.resourceId}`;
          severity = "MEDIUM";
          break;
        case "user.create":
          title = "User baru dibuat";
          description = `${meta.email ?? a.resourceId} · role ${meta.role ?? "?"}`;
          severity = "MEDIUM";
          break;
        case "user.delete":
          title = "User dihapus";
          description = `${meta.email ?? a.resourceId}`;
          severity = "HIGH";
          break;
        case "user.update":
          title = "User diupdate";
          description = `${meta.email ?? a.resourceId}`;
          severity = "MEDIUM";
          break;
        case "settings.update":
          title = "Settings diubah";
          description = `${meta.key ?? "?"} = ${meta.value ?? "?"}`;
          severity = "MEDIUM";
          break;
        case "credential.view":
          title = "Credential dilihat";
          description = `Asset ${meta.hostname ?? a.resourceId}`;
          severity = "HIGH";
          break;
      }
      return {
        id: `audit:${a.id}`,
        type: "audit",
        title,
        description,
        severity,
        action: null,
        resourceId: a.resourceId,
        createdAt: a.createdAt.toISOString(),
      };
    });

  const alertItems: NotificationItem[] = openAlerts.map((a) => ({
    id: `alert:${a.id}`,
    type: "alert",
    title: a.title,
    description: a.description,
    severity: a.severity as NotificationItem["severity"],
    action: "acknowledge_alert",
    resourceId: a.id,
    createdAt: a.createdAt.toISOString(),
  }));

  // Merge + sort by createdAt desc
  const all = [...alertItems, ...auditItems].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return Response.json({
    notifications: all.slice(0, limit),
    unreadCount: all.length, // simple: all OPEN alerts + recent audit are "new"
  });
}
