/**
 * /api/mock/generate — Generate mock data for testing (OWNER only)
 *
 * POST /api/mock/generate
 * Body: { scale?: "small" | "medium" | "large", batchId?: string }
 *
 * Creates:
 *   - 6-12 assets (SSH + DATABASE, varied environments)
 *   - SSH events (success + failed) across last 24h
 *   - DB events (success + failed/denied) across last 24h
 *   - Alerts (CRITICAL/HIGH/MEDIUM) for threat patterns
 *
 * All mock assets are named with prefix "mock-{batchId}-{n}.test.local"
 * so they can be cleanly deleted via /api/mock/clear (cascade).
 *
 * OWASP A01:2021 — OWNER-only access (requireRole with OWNER)
 * OWASP A09:2021 — audit logged
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/security/rbac";
import { audit } from "@/lib/security/audit";
import { z } from "zod";
import { randomUUID } from "crypto";

function randomInt(max: number): number {
  return Math.floor(Math.random() * max);
}

const schema = z.object({
  scale: z.enum(["small", "medium", "large"]).default("medium"),
  batchId: z.string().optional(),
});

// Realistic attacker/source IP pool (RFC 5737 docs + private ranges)
const SOURCE_IPS = [
  "203.0.113.45",   // attacker — brute force
  "198.51.100.22",  // attacker — concentrated
  "198.51.100.105", // attacker
  "198.51.100.220", // attacker
  "192.0.2.78",     // normal ops
  "10.0.0.15",      // corp net
  "10.0.0.42",      // corp net
  "172.16.5.10",    // corp net
  "172.16.5.11",    // corp net
];

const SSH_USERNAMES = ["root", "admin", "deploy", "ubuntu", "ec2-user", "jenkins", "git", "support"];
const DB_USERNAMES = ["postgres", "admin", "app_user", "reporting", "backup", "readonly"];

const ASSET_TEMPLATES = [
  { hostname: "prod-bastion",  category: "SSH" as const,      environment: "PROD" as const,    os: "Ubuntu 24.04" },
  { hostname: "prod-web-01",   category: "SSH" as const,      environment: "PROD" as const,    os: "Ubuntu 22.04" },
  { hostname: "prod-db-pg-01", category: "DATABASE" as const, environment: "PROD" as const,    os: "Debian 12",    dbType: "POSTGRES" as const },
  { hostname: "prod-db-my-01", category: "DATABASE" as const, environment: "PROD" as const,    os: "Debian 12",    dbType: "MYSQL" as const },
  { hostname: "stg-app-01",    category: "SSH" as const,      environment: "STAGING" as const, os: "Ubuntu 24.04" },
  { hostname: "stg-db-mssql",  category: "DATABASE" as const, environment: "STAGING" as const, os: "Windows Server 2022", dbType: "SQLSERVER" as const },
  { hostname: "uat-web-01",    category: "SSH" as const,      environment: "UAT" as const,     os: "Ubuntu 22.04" },
  { hostname: "uat-db-pg",     category: "DATABASE" as const, environment: "UAT" as const,     os: "Debian 12",    dbType: "POSTGRES" as const },
  { hostname: "dev-sandbox",    category: "SSH" as const,      environment: "DEV" as const,     os: "Fedora 41" },
  { hostname: "dr-bastion",    category: "SSH" as const,      environment: "DR" as const,      os: "Ubuntu 24.04" },
  { hostname: "dr-db-pg",      category: "DATABASE" as const, environment: "DR" as const,      os: "Debian 12",    dbType: "POSTGRES" as const },
  { hostname: "prod-jumpbox",  category: "SSH" as const,      environment: "PROD" as const,    os: "Rocky Linux 9" },
];

const SCALE_CONFIG = {
  small:  { sshEventsPerAsset: 30,  dbEventsPerAsset: 20, alertCount: 3 },
  medium: { sshEventsPerAsset: 80,  dbEventsPerAsset: 50, alertCount: 6 },
  large:  { sshEventsPerAsset: 200, dbEventsPerAsset: 120, alertCount: 10 },
} as const;

export async function POST(req: NextRequest) {
  // OWNER only — mock data is destructive test infrastructure
  const auth = await requireRole("OWNER");
  if (auth instanceof NextResponse) return auth;
  const session = auth;

  let body: z.infer<typeof schema> = { scale: "medium" };
  try {
    const raw = await req.json().catch(() => ({}));
    body = schema.parse(raw);
  } catch (err) {
    return NextResponse.json({ error: "Invalid body", details: String(err) }, { status: 400 });
  }

  const batchId = body.batchId || randomUUID().slice(0, 8);
  const cfg = SCALE_CONFIG[body.scale];

  try {
    // 1. Create assets
    const assets = await Promise.all(
      ASSET_TEMPLATES.map((tpl, idx) => {
        const hostname = `mock-${batchId}-${idx + 1}-${tpl.hostname}.test.local`;
        return prisma.asset.create({
          data: {
            userId: session.userId,
            category: tpl.category,
            environment: tpl.environment,
            hostname,
            os: tpl.os,
            publicIp: SOURCE_IPS[randomInt(SOURCE_IPS.length)],
            privateIp: `10.${randomInt(255)}.${randomInt(255)}.${randomInt(255)}`,
            sshPort: 22,
            sshUser: tpl.category === "SSH" ? "root" : undefined,
            dbType: tpl.dbType ?? "NONE",
            dbHost: tpl.category === "DATABASE" ? "localhost" : undefined,
            dbPort: tpl.dbType === "POSTGRES" ? 5432 : tpl.dbType === "MYSQL" ? 3306 : tpl.dbType === "SQLSERVER" ? 1433 : undefined,
            dbName: tpl.dbType === "POSTGRES" ? "postgres" : tpl.dbType === "MYSQL" ? "mysql" : "master",
            dbUser: tpl.category === "DATABASE" ? "app_user" : undefined,
            status: randomInt(10) > 1 ? "ONLINE" : "PENDING",
            lastSeenAt: randomInt(10) > 2 ? new Date(Date.now() - randomInt(120_000)) : null,
          },
        });
      })
    );

    // 2. Generate SSH events spread across last 24h
    const sshAssets = assets.filter((a) => a.category === "SSH");
    const dbAssets  = assets.filter((a) => a.category === "DATABASE");

    const sshEventsData: Array<{
      assetId: string;
      username: string;
      sourceIp: string;
      status: "SUCCESS" | "FAILED" | "INVALID";
      method: string;
      eventTime: Date;
      country: string;
    }> = [];

    const now = Date.now();
    for (const asset of sshAssets) {
      // 75% success / 20% failed / 5% invalid
      for (let i = 0; i < cfg.sshEventsPerAsset; i++) {
        const r = randomInt(100);
        const status: "SUCCESS" | "FAILED" | "INVALID" =
          r < 75 ? "SUCCESS" : r < 95 ? "FAILED" : "INVALID";
        // Failed attempts more likely from attacker IPs
        const ip =
          status !== "SUCCESS" && randomInt(100) < 40
            ? SOURCE_IPS.slice(0, 4)[randomInt(4)] // attacker pool
            : SOURCE_IPS[randomInt(SOURCE_IPS.length)];
        sshEventsData.push({
          assetId: asset.id,
          username: SSH_USERNAMES[randomInt(SSH_USERNAMES.length)],
          sourceIp: ip,
          status,
          method: randomInt(100) < 70 ? "publickey" : "password",
          eventTime: new Date(now - randomInt(86_400_000)), // last 24h
          country: pickCountry(ip),
        });
      }
    }

    // Bulk insert SSH events
    await prisma.sshEvent.createMany({ data: sshEventsData });

    // 3. Generate DB events
    const dbEventsData: Array<{
      assetId: string;
      dbType: "POSTGRES" | "MYSQL" | "SQLSERVER";
      username: string;
      sourceIp: string;
      database: string;
      status: "SUCCESS" | "FAILED" | "DENIED";
      eventTime: Date;
    }> = [];

    for (const asset of dbAssets) {
      const dbType = (asset.dbType ?? "POSTGRES") as "POSTGRES" | "MYSQL" | "SQLSERVER";
      const defaultDb = dbType === "POSTGRES" ? "postgres" : dbType === "MYSQL" ? "mysql" : "master";
      for (let i = 0; i < cfg.dbEventsPerAsset; i++) {
        const r = randomInt(100);
        const status: "SUCCESS" | "FAILED" | "DENIED" =
          r < 80 ? "SUCCESS" : r < 95 ? "FAILED" : "DENIED";
        const ip =
          status !== "SUCCESS" && randomInt(100) < 30
            ? SOURCE_IPS.slice(0, 4)[randomInt(4)]
            : SOURCE_IPS[randomInt(SOURCE_IPS.length)];
        dbEventsData.push({
          assetId: asset.id,
          dbType,
          username: DB_USERNAMES[randomInt(DB_USERNAMES.length)],
          sourceIp: ip,
          database: defaultDb,
          status,
          eventTime: new Date(now - randomInt(86_400_000)),
        });
      }
    }
    await prisma.dbEvent.createMany({ data: dbEventsData });

    // 4. Generate alerts (CRITICAL for brute-force patterns)
    const alertTitles = [
      { severity: "CRITICAL" as const, title: "Brute-force attack detected",     desc: "Multiple failed SSH attempts from single source IP exceeding threshold (20 fails / 10 min)" },
      { severity: "CRITICAL" as const, title: "Suspicious login pattern",          desc: "Login attempts from 5 different users from same IP within 5 minutes" },
      { severity: "HIGH" as const,     title: "Repeated failed authentication",    desc: "Same user failing authentication 10+ times across multiple hosts" },
      { severity: "HIGH" as const,     title: "Database access from unusual IP",   desc: "Database login from IP outside normal corporate range" },
      { severity: "HIGH" as const,     title: "After-hours privileged access",     desc: "Root login detected outside business hours (22:00 - 06:00 local)" },
      { severity: "MEDIUM" as const,   title: "New source IP for known user",       desc: "User authenticated from IP not seen in last 30 days" },
      { severity: "MEDIUM" as const,   title: "High DB query rate from single user", desc: "Single user executing 200+ queries/minute against production database" },
      { severity: "MEDIUM" as const,   title: "Geo-anomaly on SSH login",          desc: "SSH login from country not previously associated with user" },
      { severity: "LOW" as const,      title: "Stale credentials detected",        desc: "Asset credentials not rotated in 180+ days" },
      { severity: "LOW" as const,      title: "Unusual SSH method",                desc: "Password authentication used where key-based is expected" },
    ];

    const selectedAlerts = alertTitles.slice(0, cfg.alertCount);
    const alertsData = selectedAlerts.map((a, idx) => {
      const sshAsset = sshAssets[randomInt(sshAssets.length)] ?? assets[0];
      const sourceIp = SOURCE_IPS.slice(0, 4)[randomInt(4)];
      const alertTime = new Date(now - randomInt(7 * 86_400_000)); // last 7 days
      const alertStatus: "OPEN" | "RESOLVED" = randomInt(10) > 7 ? "RESOLVED" : "OPEN";
      return {
        assetId: sshAsset.id,
        severity: a.severity,
        title: a.title,
        description: a.desc,
        status: alertStatus,
        resolvedAt: alertStatus === "RESOLVED" ? new Date(alertTime.getTime() + randomInt(3_600_000)) : null,
        metadata: {
          sourceIp,
          eventCount: randomInt(50) + 10,
          window: "10m",
          pattern: a.severity === "CRITICAL" ? "brute_force" : "anomaly",
          mockBatchId: batchId,
        },
        createdAt: alertTime,
      };
    });
    await prisma.alert.createMany({ data: alertsData });

    // 5. Audit log
    await audit({
      userId: session.userId,
      action: "mock.generate",
      resourceType: "mock_data",
      metadata: {
        batchId,
        scale: body.scale,
        assets: assets.length,
        sshEvents: sshEventsData.length,
        dbEvents: dbEventsData.length,
        alerts: alertsData.length,
      },
    });

    return NextResponse.json({
      ok: true,
      batchId,
      scale: body.scale,
      created: {
        assets: assets.length,
        sshEvents: sshEventsData.length,
        dbEvents: dbEventsData.length,
        alerts: alertsData.length,
      },
    });
  } catch (err) {
    console.error("[mock/generate] failed", err);
    return NextResponse.json(
      { error: "Failed to generate mock data", details: String(err) },
      { status: 500 }
    );
  }
}

function pickCountry(ip: string): string {
  if (ip.startsWith("203.0.113")) return "ZZ"; // TEST-NET-3
  if (ip.startsWith("198.51.100")) return "ZZ";
  if (ip.startsWith("192.0.2")) return "US";
  if (ip.startsWith("10.")) return "ID";
  if (ip.startsWith("172.16")) return "ID";
  return "ID";
}
