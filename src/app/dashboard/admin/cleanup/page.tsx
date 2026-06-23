import { prisma } from "@/lib/db";
import { getSession } from "@/lib/security/rbac";
import {
  Trash2,
  AlertTriangle,
  Calendar,
  Database,
  Clock,
  Settings,
  PlayCircle,
  History,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { CleanupAdminContent } from "./_components/cleanup-admin-content";

// Retention policy keys (must match src/app/api/admin/cleanup/route.ts)
const SETTING_HIGH = "eventlog.retention.high_days";
const SETTING_LOW = "eventlog.retention.low_days";
const DEFAULT_HIGH = 40;
const DEFAULT_LOW = 3;

const TABLES = [
  { model: "tEventLogSyslog", label: "syslog", key: SETTING_LOW },
  { model: "tEventLogFim", label: "fim", key: SETTING_LOW },
  { model: "tEventLogAuditd", label: "auditd", key: SETTING_LOW },
  { model: "tEventLogServerAuth", label: "server_auth", key: SETTING_HIGH },
  { model: "tEventLogAgentApps", label: "agent_apps", key: SETTING_HIGH },
  { model: "tEventLogDatabase", label: "database", key: SETTING_HIGH },
  { model: "tEventLogNetwork", label: "network", key: SETTING_HIGH },
  { model: "tEventLogUserAccess", label: "user_access", key: SETTING_HIGH },
] as const;

export const dynamic = "force-dynamic";

export default async function AdminCleanupPage() {
  const session = await getSession();
  if (!session) return null;
  // OWNER/ADMIN only (route guards it too; this is defense-in-depth)
  if (session.role !== "OWNER" && session.role !== "ADMIN") {
    return (
      <div className="p-6">
        <div className="flex items-start gap-3 p-4 rounded-lg bg-red-500/10 border border-red-500/30">
          <AlertTriangle className="h-5 w-5 text-red-400 mt-0.5" />
          <div>
            <h1 className="text-lg font-semibold text-red-300">
              Access denied
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Cleanup admin requires OWNER or ADMIN role. You are:{" "}
              <span className="font-mono">{session.role}</span>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Load current settings
  const settingRows = await prisma.systemSetting.findMany({
    where: { key: { in: [SETTING_HIGH, SETTING_LOW] } },
  });
  const settingsMap: Record<string, number> = {};
  for (const r of settingRows) {
    try {
      settingsMap[r.key] = JSON.parse(r.value);
    } catch {}
  }
  const policy = {
    highDays: settingsMap[SETTING_HIGH] ?? DEFAULT_HIGH,
    lowDays: settingsMap[SETTING_LOW] ?? DEFAULT_LOW,
  };

  // Per-table counts
  const tableStats = await Promise.all(
    TABLES.map(async ({ model, label, key }) => {
      const m = prisma[model as keyof typeof prisma] as any;
      const retentionDays =
        key === SETTING_HIGH ? policy.highDays : policy.lowDays;
      const cutoff = new Date(
        Date.now() - retentionDays * 24 * 60 * 60 * 1000
      );
      const total = await m.count();
      const oldest = await m.findFirst({
        orderBy: { eventTime: "asc" },
        select: { eventTime: true },
      });
      const expired = await m.count({
        where: { eventTime: { lt: cutoff } },
      });
      return {
        model,
        label,
        retentionDays,
        total,
        oldest: oldest?.eventTime?.toISOString() ?? null,
        expired,
      };
    })
  );

  // Last 5 cleanup runs
  const lastRuns = await prisma.auditLog.findMany({
    where: { action: "eventlog.cleanup" },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { createdAt: true, metadata: true, userId: true },
  });

  const initialData = {
    policy,
    tables: tableStats,
    lastRuns: lastRuns.map((r) => ({
      ranAt: r.createdAt.toISOString(),
      totalDeleted: (r.metadata as any)?.totalDeleted ?? 0,
      dryRun: (r.metadata as any)?.dryRun ?? false,
      highDays: (r.metadata as any)?.highDays,
      lowDays: (r.metadata as any)?.lowDays,
      summary: (r.metadata as any)?.summary ?? [],
    })),
  };

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Trash2 className="h-6 w-6 text-rose-400" />
            Event Log Cleanup
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Scheduled deletion of old event logs based on per-table retention
            policy. Runs nightly via systemd timer.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="text-sm text-slate-400 hover:text-slate-200"
        >
          ← Back to dashboard
        </Link>
      </header>

      <CleanupAdminContent initialData={initialData} />
    </div>
  );
}