import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole, PERMISSIONS } from "@/lib/security/rbac";
import { audit } from "@/lib/security/audit";
import { execFile } from "child_process";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// Retention policy keys (stored in system_settings table)
const SETTING_HIGH = "eventlog.retention.high_days";
const SETTING_LOW = "eventlog.retention.low_days";

const DEFAULT_HIGH = 40;
const DEFAULT_LOW = 3;

const CLEANUP_SCRIPT = path.join(
  process.cwd(),
  "scripts",
  "cleanup-event-logs.mjs"
);

// Tables we expose in the API surface
const TABLES = [
  { model: "tEventLogSyslog", label: "syslog", daysKey: SETTING_LOW, defaultDays: DEFAULT_LOW },
  { model: "tEventLogFim", label: "fim", daysKey: SETTING_LOW, defaultDays: DEFAULT_LOW },
  { model: "tEventLogAuditd", label: "auditd", daysKey: SETTING_LOW, defaultDays: DEFAULT_LOW },
  { model: "tEventLogServerAuth", label: "server_auth", daysKey: SETTING_HIGH, defaultDays: DEFAULT_HIGH },
  { model: "tEventLogAgentApps", label: "agent_apps", daysKey: SETTING_HIGH, defaultDays: DEFAULT_HIGH },
  { model: "tEventLogDatabase", label: "database", daysKey: SETTING_HIGH, defaultDays: DEFAULT_HIGH },
  { model: "tEventLogNetwork", label: "network", daysKey: SETTING_HIGH, defaultDays: DEFAULT_HIGH },
  { model: "tEventLogUserAccess", label: "user_access", daysKey: SETTING_HIGH, defaultDays: DEFAULT_HIGH },
];

// ---------- Settings helpers ----------

async function getSettings() {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: [SETTING_HIGH, SETTING_LOW] } },
  });
  const map: Record<string, number> = {};
  for (const r of rows) {
    try {
      map[r.key] = JSON.parse(r.value);
    } catch {
      // ignore malformed
    }
  }
  return {
    highDays: map[SETTING_HIGH] ?? DEFAULT_HIGH,
    lowDays: map[SETTING_LOW] ?? DEFAULT_LOW,
  };
}

// ---------- GET: report current policy + per-table counts ----------

export async function GET() {
  const auth = await requireRole(...PERMISSIONS.SETTINGS_READ);
  if (auth instanceof Response) return auth;

  const settings = await getSettings();

  // Per-table counts + age breakdown
  const tableStats = await Promise.all(
    TABLES.map(async ({ model, label, daysKey }) => {
      const m = prisma[model as keyof typeof prisma] as any;
      const retentionDays =
        daysKey === SETTING_HIGH ? settings.highDays : settings.lowDays;
      const cutoff = new Date(
        Date.now() - retentionDays * 24 * 60 * 60 * 1000
      );
      const total = await m.count();

      const oldest = await m.findFirst({
        orderBy: { eventTime: "asc" },
        select: { eventTime: true },
      });

      const expiredCount = await m.count({
        where: { eventTime: { lt: cutoff } },
      });

      return {
        model,
        label,
        retentionDays,
        total,
        oldest: oldest?.eventTime?.toISOString() ?? null,
        expired: expiredCount,
      };
    })
  );

  // Last 5 cleanup runs from audit log
  const lastRuns = await prisma.auditLog.findMany({
    where: { action: "eventlog.cleanup" },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      createdAt: true,
      metadata: true,
      userId: true,
    },
  });

  return NextResponse.json({
    policy: {
      highDays: settings.highDays,
      lowDays: settings.lowDays,
      tables: tableStats,
    },
    lastRuns: lastRuns.map((r) => ({
      ranAt: r.createdAt.toISOString(),
      totalDeleted: (r.metadata as any)?.totalDeleted ?? 0,
      dryRun: (r.metadata as any)?.dryRun ?? false,
      highDays: (r.metadata as any)?.highDays,
      lowDays: (r.metadata as any)?.lowDays,
      summary: (r.metadata as any)?.summary ?? [],
    })),
    script: "scripts/cleanup-event-logs.mjs",
  });
}

// ---------- POST: trigger cleanup ----------

export async function POST(req: NextRequest) {
  const auth = await requireRole(...PERMISSIONS.SETTINGS_WRITE);
  if (auth instanceof Response) return auth;

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dryRun === true;
  const overrideHigh =
    typeof body.highDays === "number" && body.highDays >= 1 && body.highDays <= 365
      ? body.highDays
      : undefined;
  const overrideLow =
    typeof body.lowDays === "number" && body.lowDays >= 1 && body.lowDays <= 365
      ? body.lowDays
      : undefined;

  // Build env to pass to the script
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    NODE_ENV: process.env.NODE_ENV ?? "production",
  };
  if (overrideHigh !== undefined) env.EVENTLOG_RETENTION_HIGH = String(overrideHigh);
  if (overrideLow !== undefined) env.EVENTLOG_RETENTION_LOW = String(overrideLow);

  // Run the script. Use execFile for safety (no shell interpolation).
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  try {
    const result = await execFileAsync(
      "node",
      [CLEANUP_SCRIPT, ...(dryRun ? ["--dry-run"] : [])],
      { env, timeout: 5 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 }
    );
    stdout = result.stdout;
    stderr = result.stderr;
    exitCode = 0;
  } catch (err: any) {
    stdout = err.stdout ?? "";
    stderr = err.stderr ?? String(err.message ?? err);
    exitCode = err.code ?? 1;
  }

  // Parse the last JSON-line summary from stdout (the script emits one per run)
  const lines = stdout.trim().split("\n").filter(Boolean);
  let summary: any = null;
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj?.component === "event-log-cleanup" && obj?.totalDeleted !== undefined) {
        summary = obj;
      }
    } catch {
      // skip non-JSON lines (if any)
    }
  }

  await audit({
    action: "eventlog.cleanup.manual",
    resourceType: "system",
    metadata: {
      dryRun,
      overrideHigh,
      overrideLow,
      exitCode,
      totalDeleted: summary?.totalDeleted ?? 0,
      summary: summary?.summary ?? [],
      triggeredBy: auth.email,
    },
  });

  return NextResponse.json({
    ok: exitCode === 0,
    exitCode,
    dryRun,
    stdout,
    stderr: stderr || undefined,
    summary,
  });
}

// ---------- PATCH: update retention policy ----------

export async function PATCH(req: NextRequest) {
  const auth = await requireRole(...PERMISSIONS.SETTINGS_WRITE);
  if (auth instanceof Response) return auth;

  const body = await req.json().catch(() => ({}));
  const highDays =
    typeof body.highDays === "number" && body.highDays >= 1 && body.highDays <= 365
      ? Math.floor(body.highDays)
      : undefined;
  const lowDays =
    typeof body.lowDays === "number" && body.lowDays >= 1 && body.lowDays <= 365
      ? Math.floor(body.lowDays)
      : undefined;

  if (highDays === undefined && lowDays === undefined) {
    return NextResponse.json(
      { error: "BadRequest", message: "Provide highDays and/or lowDays (1-365)" },
      { status: 400 }
    );
  }

  // Require lowDays <= highDays (low retention must be shorter than high)
  const current = await getSettings();
  const newHigh = highDays ?? current.highDays;
  const newLow = lowDays ?? current.lowDays;
  if (newLow > newHigh) {
    return NextResponse.json(
      {
        error: "BadRequest",
        message: `lowDays (${newLow}) must be <= highDays (${newHigh})`,
      },
      { status: 400 }
    );
  }

  const updates: Array<{ key: string; value: string }> = [];
  if (highDays !== undefined) {
    updates.push({ key: SETTING_HIGH, value: JSON.stringify(highDays) });
  }
  if (lowDays !== undefined) {
    updates.push({ key: SETTING_LOW, value: JSON.stringify(lowDays) });
  }

  for (const { key, value } of updates) {
    await prisma.systemSetting.upsert({
      where: { key },
      create: { key, value, updatedBy: auth.email },
      update: { value, updatedBy: auth.email },
    });
  }

  await audit({
    action: "eventlog.retention.update",
    resourceType: "system",
    metadata: {
      previous: current,
      updated: { highDays: newHigh, lowDays: newLow },
      changedBy: auth.email,
    },
  });

  return NextResponse.json({
    ok: true,
    policy: { highDays: newHigh, lowDays: newLow },
  });
}