import { prisma } from "@/lib/db";
import { getSession } from "@/lib/security/rbac";
import {
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  Bell,
  Server,
} from "lucide-react";

const severityMeta: Record<
  string,
  {
    label: string;
    color: string; // hex for inline styles
    icon: React.ComponentType<{
      className?: string;
      strokeWidth?: number;
      style?: React.CSSProperties;
    }>;
  }
> = {
  LOW: { label: "Low", color: "#60a5fa", icon: CheckCircle2 },
  MEDIUM: { label: "Medium", color: "#fbbf24", icon: AlertTriangle },
  HIGH: { label: "High", color: "#f97316", icon: AlertTriangle },
  CRITICAL: { label: "Critical", color: "#ef4444", icon: AlertOctagon },
};

function timeAgo(d: Date) {
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d2 = Math.floor(h / 24);
  return `${d2}d ago`;
}

export default async function AlertsPage() {
  const session = await getSession();
  if (!session) return null;

  // Try alerts table first
  let alerts = await prisma.alert.findMany({
    where: {
      OR: [
        { asset: { userId: session.userId } },
        { assetId: null },
      ],
    },
    orderBy: [{ status: "asc" }, { severity: "desc" }, { createdAt: "desc" }],
    take: 50,
    select: {
      id: true,
      severity: true,
      title: true,
      description: true,
      status: true,
      createdAt: true,
      asset: { select: { hostname: true } },
    },
  });

  // Fallback (2026-06-21 refactor): pull recent ERROR/CRITICAL events from
  // multiple per-type tables (syslog daemon errors + apps service errors +
  // server auth failures). UNION-equivalent via Promise.all + sort + slice.
  if (alerts.length === 0) {
    const [syslogEvents, appsEvents, authEvents] = await Promise.all([
      prisma.tEventLogSyslog.findMany({
        where: { severity: { in: ["ERROR", "CRITICAL"] } },
        orderBy: { eventTime: "desc" },
        take: 30,
        select: {
          id: true,
          severity: true,
          source: true,
          message: true,
          eventTime: true,
          agent: { select: { name: true, hostname: true } },
        },
      }),
      prisma.tEventLogApps.findMany({
        where: { severity: { in: ["ERROR", "CRITICAL"] } },
        orderBy: { eventTime: "desc" },
        take: 20,
        select: {
          id: true,
          severity: true,
          appName: true,
          message: true,
          eventTime: true,
          agent: { select: { name: true, hostname: true } },
        },
      }),
      prisma.tEventLogServerAuth.findMany({
        where: { status: "FAILED" },
        orderBy: { eventTime: "desc" },
        take: 20,
        select: {
          id: true,
          username: true,
          sourceIp: true,
          raw: true,
          eventTime: true,
          agent: { select: { name: true, hostname: true } },
        },
      }),
    ]);

    const fallbackAlerts = [
      ...syslogEvents.map((e) => ({
        id: "syslog:" + e.id,
        severity: e.severity === "CRITICAL" ? "CRITICAL" as const : "HIGH" as const,
        title: (e.source.split("/").pop() || e.source) + " (syslog)",
        description: e.message,
        status: "OPEN" as const,
        createdAt: e.eventTime,
        assetHostname: e.agent?.hostname || e.agent?.name || "unknown",
      })),
      ...appsEvents.map((e) => ({
        id: "apps:" + e.id,
        severity: e.severity === "CRITICAL" ? "CRITICAL" as const : "HIGH" as const,
        title: e.appName + " error",
        description: e.message,
        status: "OPEN" as const,
        createdAt: e.eventTime,
        assetHostname: e.agent?.hostname || e.agent?.name || "unknown",
      })),
      ...authEvents.map((e) => ({
        id: "auth:" + e.id,
        severity: "HIGH" as const,
        title: `Failed auth: ${e.username}@${e.sourceIp}`,
        description: e.raw ?? `Failed authentication for ${e.username} from ${e.sourceIp}`,
        status: "OPEN" as const,
        createdAt: e.eventTime,
        assetHostname: e.agent?.hostname || e.agent?.name || "unknown",
      })),
    ];

    // Sort all by createdAt desc, slice to top 50
    fallbackAlerts.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    alerts = fallbackAlerts.slice(0, 50).map((e) => ({
      id: e.id,
      severity: e.severity,
      title: e.title,
      description: e.description,
      status: e.status,
      createdAt: e.createdAt,
      asset: { hostname: e.assetHostname },
    }));
  }

  const openCount = alerts.filter((a) => a.status === "OPEN").length;
  const criticalOpen = alerts.filter(
    (a) => a.status === "OPEN" && a.severity === "CRITICAL",
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Alerts</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            {openCount === 0
              ? "All alerts resolved 🎉"
              : `${openCount} open alert${openCount !== 1 ? "s" : ""}${criticalOpen > 0 ? ` · ${criticalOpen} critical` : ""}`}
          </p>
        </div>
      </div>

      {alerts.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-[var(--border-strong)] p-12 text-center">
          <Bell
            className="h-10 w-10 text-[var(--muted-foreground)] mx-auto"
            strokeWidth={1.5}
          />
          <h3 className="mt-4 text-sm font-semibold">No alerts</h3>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Sistem aman. Alerts bakal muncul di sini kalo ada anomali.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {alerts.map((a) => {
            const meta = severityMeta[a.severity] || severityMeta.MEDIUM;
            const Icon = meta.icon;
            const isOpen = a.status === "OPEN";
            return (
              <div
                key={a.id}
                className={`rounded-xl border p-4 transition-colors ${
                  isOpen
                    ? "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent-border)]"
                    : "border-[var(--border)] bg-[var(--surface)]/50 opacity-70"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="shrink-0 h-9 w-9 rounded-lg flex items-center justify-center"
                    style={{
                      backgroundColor: `${meta.color}15`,
                      borderColor: `${meta.color}40`,
                      borderWidth: 1,
                    }}
                  >
                    <Icon
                      className="h-4 w-4"
                      style={{ color: meta.color }}
                      strokeWidth={2}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                      <span
                        className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded"
                        style={{
                          backgroundColor: `${meta.color}15`,
                          color: meta.color,
                          borderColor: `${meta.color}40`,
                          borderWidth: 1,
                        }}
                      >
                        {meta.label}
                      </span>
                      {a.asset?.hostname && (
                        <span className="text-[10px] text-[var(--muted-foreground)] font-mono flex items-center gap-1">
                          <Server className="h-2.5 w-2.5" />
                          {a.asset.hostname}
                        </span>
                      )}
                      <span className="text-[10px] text-[var(--muted-foreground)] font-mono">
                        · {timeAgo(a.createdAt)}
                      </span>
                      {!isOpen && (
                        <span
                          className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded ${
                            a.status === "RESOLVED"
                              ? "bg-[var(--success)]/10 text-[var(--success)] border border-[var(--success)]/30"
                              : "bg-white/[0.04] text-[var(--muted-foreground)] border border-[var(--border)]"
                          }`}
                        >
                          {a.status}
                        </span>
                      )}
                    </div>
                    <h3 className="text-sm font-semibold leading-tight">{a.title}</h3>
                    <p className="mt-1 text-xs text-[var(--muted-foreground)] leading-relaxed line-clamp-2">
                      {a.description}
                    </p>
                    <div className="mt-1 text-[10px] font-mono text-[var(--muted-foreground)] opacity-60">
                      {new Date(a.createdAt).toLocaleString("id-ID")}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
