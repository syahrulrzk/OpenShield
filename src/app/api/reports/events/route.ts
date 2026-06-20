/**
 * /api/reports/events — Excel export of SSH + DB events
 *
 * GET /api/reports/events?days=7&type=ssh|db|all
 *
 * Returns .xlsx file with all events in the period.
 */

import { prisma } from "@/lib/db";
import { requireRole, PERMISSIONS } from "@/lib/security/rbac";
import { audit } from "@/lib/security/audit";
import ExcelJS from "exceljs";
import { subDays } from "date-fns";

export async function GET(req: Request) {
  const auth = await requireRole(...PERMISSIONS.ASSET_READ);
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const days = Math.min(parseInt(url.searchParams.get("days") ?? "7"), 90);
  const type = url.searchParams.get("type") ?? "all";

  const since = subDays(new Date(), days);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ua = req.headers.get("user-agent") ?? undefined;

  const wb = new ExcelJS.Workbook();
  wb.creator = "OpenShield";
  wb.created = new Date();

  if (type === "all" || type === "ssh") {
    const sheet = wb.addWorksheet("SSH Events");
    sheet.columns = [
      { header: "Time", key: "time", width: 22 },
      { header: "Hostname", key: "hostname", width: 24 },
      { header: "Username", key: "username", width: 18 },
      { header: "Source IP", key: "sourceIp", width: 18 },
      { header: "Status", key: "status", width: 10 },
      { header: "Method", key: "method", width: 12 },
      { header: "Country", key: "country", width: 10 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF000000" },
    };
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };

    const events = await prisma.serverEvent.findMany({
      where: { asset: { userId: auth.userId }, eventTime: { gte: since } },
      orderBy: { eventTime: "desc" },
      include: { asset: { select: { hostname: true } } },
    });
    for (const e of events) {
      const row = sheet.addRow({
        time: e.eventTime,
        hostname: e.asset.hostname,
        username: e.username,
        sourceIp: e.sourceIp,
        status: e.status,
        method: e.method ?? "",
        country: e.country ?? "",
      });
      // Color the status cell
      const statusCell = row.getCell("status");
      if (e.status === "SUCCESS") {
        statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1FAE5" } };
        statusCell.font = { color: { argb: "FF065F46" } };
      } else {
        statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
        statusCell.font = { color: { argb: "FF991B1B" } };
      }
    }
  }

  if (type === "all" || type === "db") {
    const sheet = wb.addWorksheet("DB Events");
    sheet.columns = [
      { header: "Time", key: "time", width: 22 },
      { header: "Hostname", key: "hostname", width: 24 },
      { header: "DB Type", key: "dbType", width: 12 },
      { header: "Username", key: "username", width: 18 },
      { header: "Source IP", key: "sourceIp", width: 18 },
      { header: "Database", key: "database", width: 16 },
      { header: "Status", key: "status", width: 10 },
    ];
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF000000" } };

    const events = await prisma.dbEvent.findMany({
      where: { asset: { userId: auth.userId }, eventTime: { gte: since } },
      orderBy: { eventTime: "desc" },
      include: { asset: { select: { hostname: true } } },
    });
    for (const e of events) {
      const row = sheet.addRow({
        time: e.eventTime,
        hostname: e.asset.hostname,
        dbType: e.dbType,
        username: e.username,
        sourceIp: e.sourceIp ?? "",
        database: e.database ?? "",
        status: e.status,
      });
      const statusCell = row.getCell("status");
      if (e.status === "SUCCESS") {
        statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1FAE5" } };
        statusCell.font = { color: { argb: "FF065F46" } };
      } else {
        statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
        statusCell.font = { color: { argb: "FF991B1B" } };
      }
    }
  }

  await audit({
    userId: auth.userId,
    action: "credential.view",
    resourceType: "report",
    resourceId: "events",
    ip,
    userAgent: ua,
    metadata: { type, days, events: wb.worksheets.reduce((s, w) => s + w.rowCount - 1, 0) },
  });

  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="openshield-events-${days}d-${type}.xlsx"`,
    },
  });
}
