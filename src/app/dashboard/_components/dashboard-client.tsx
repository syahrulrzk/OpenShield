"use client";

import * as React from "react";
import {
  LayoutDashboard,
  Server,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Activity,
  Database,
  Globe,
  Clock,
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  ArrowRight,
  Plus,
  Rocket,
  AppWindow,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { motion } from "framer-motion";
import { AnimatedNumber, StaggerContainer, StaggerItem, ChartReveal, PulseDot, FadeIn } from "@/components/animations";
import { formatNumber, formatRelativeTime } from "@/lib/format";

type Stats = Awaited<ReturnType<typeof import("../page").default>> extends React.ReactElement
  ? never
  : any;

type DashboardStats = {
  totalAgents: number;
  onlineAgents: number;
  assetsByStatus: Record<string, number>;
  assetsByDbType: Record<string, number>;
  assetsByEnvironment: Record<string, number>;
  serverSuccessToday: number;
  serverFailedToday: number;
  serverLast24h: number;
  dbSuccessToday: number;
  dbFailedToday: number;
  dbLast24h: number;
  dbByType: Record<string, number>;
  openAlerts: number;
  criticalAlerts: number;
  alertsBySeverity: Record<string, number>;
  topSshAttackers: { ip: string; count: number }[];
  topDbAttackers: { ip: string; dbType: string; count: number }[];
  topCountries: { country: string; count: number }[];
  serverTimeseries: { hour: string; success: number; failed: number }[];
  dbTimeseries: { hour: string; success: number; failed: number }[];
  recentSsh: { id: string; hostname: string; username: string; sourceIp: string; status: string; eventTime: string }[];
  recentDb: { id: string; hostname: string; dbType: string; username: string; sourceIp: string | null; status: string; eventTime: string }[];
};

const STATUS_COLORS: Record<string, string> = {
  ONLINE: "#10b981",
  OFFLINE: "#71717a",
  PENDING: "#f59e0b",
  ERROR: "#ef4444",
};

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "#ef4444",
  HIGH: "#f97316",
  MEDIUM: "#f59e0b",
  LOW: "#3b82f6",
};

const DB_TYPE_COLORS: Record<string, string> = {
  POSTGRES: "#336791",
  MYSQL: "#00758f",
  SQLSERVER: "#cc2927",
};

const tooltipStyle = {
  contentStyle: {
    backgroundColor: "rgba(10, 10, 10, 0.95)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    fontSize: 12,
    backdropFilter: "blur(8px)",
  },
  labelStyle: { color: "rgba(255,255,255,0.5)", fontSize: 11 },
  itemStyle: { color: "rgba(255,255,255,0.9)" },
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function StatCard({
  label,
  value,
  sub,
  trend,
  icon: Icon,
  accent = "white",
}: {
  label: string;
  value: string | number;
  sub?: string;
  trend?: "up" | "down" | "neutral";
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  accent?: string;
}) {
  return (
    <motion.div
      whileHover={{ y: -2, scale: 1.005 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5 relative overflow-hidden group cursor-default"
    >
      <div className="flex items-start justify-between mb-3">
        <motion.div
          whileHover={{ rotate: 8, scale: 1.05 }}
          transition={{ type: "spring", stiffness: 400 }}
          className="h-9 w-9 rounded-lg bg-white/[0.04] border border-[var(--border)] flex items-center justify-center group-hover:bg-white/[0.06]"
        >
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </motion.div>
        {trend && (
          <div className="flex items-center gap-0.5 text-[10px] font-mono">
            {trend === "up" ? (
              <TrendingUp className="h-3 w-3 text-[var(--success)]" />
            ) : trend === "down" ? (
              <TrendingDown className="h-3 w-3 text-[var(--danger)]" />
            ) : null}
          </div>
        )}
      </div>
      <div className="text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums">
        {typeof value === "number" ? (
          <AnimatedNumber value={value} duration={1.2} />
        ) : (
          value
        )}
      </div>
      <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--muted-foreground)] mt-1.5">
        {label}
      </div>
      {sub && (
        <div className="text-[11px] text-[var(--muted)] mt-0.5 truncate">{sub}</div>
      )}
    </motion.div>
  );
}

function SectionHeader({
  title,
  sub,
  action,
}: {
  title: string;
  sub?: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="flex items-end justify-between mb-4">
      <div>
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {sub && <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{sub}</p>}
      </div>
      {action && (
        <a
          href={action.href}
          className="text-[11px] font-medium text-[var(--muted)] hover:text-[var(--foreground)] flex items-center gap-1 transition-colors"
        >
          {action.label}
          <ArrowRight className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}


interface TabItem {
  id: "overview" | "server" | "database" | "apps";
  label: string;
  icon: any;
  href?: string;
  badge?: string;
  locked?: boolean;
}

const TAB_ITEMS: TabItem[] = [] as unknown as TabItem[];

function DashboardTabs({
  activeTab: _activeTab,
  onTabChange: _onTabChange,
}: {
  activeTab: "overview" | "server" | "database" | "apps";
  onTabChange: (tab: "overview" | "server" | "database" | "apps") => void;
}) {
  // Tabs removed — navigation handled by sidebar Event Log submenu
  return null;
}

export function DashboardClient({ stats }: { stats: DashboardStats }) {
    const [activeTab, setActiveTab] = React.useState<"overview" | "server" | "database" | "apps">("overview");

  const totalServerAuth = stats.serverSuccessToday + stats.serverFailedToday;
  const totalDbAuth = stats.dbSuccessToday + stats.dbFailedToday;
  const dbTypeTotal = Object.values(stats.assetsByDbType).reduce((a, b) => a + b, 0);

  // Merge SSH + DB timeseries for combined chart
  const mergedTs = (() => {
    const map = new Map<string, { hour: string; sshSuccess: number; sshFailed: number; dbSuccess: number; dbFailed: number }>();
    stats.serverTimeseries.forEach((r) => {
      map.set(r.hour, { hour: r.hour, sshSuccess: r.success, sshFailed: r.failed, dbSuccess: 0, dbFailed: 0 });
    });
    stats.dbTimeseries.forEach((r) => {
      const existing = map.get(r.hour) || { hour: r.hour, sshSuccess: 0, sshFailed: 0, dbSuccess: 0, dbFailed: 0 };
      existing.dbSuccess = r.success;
      existing.dbFailed = r.failed;
      map.set(r.hour, existing);
    });
    return Array.from(map.values())
      .sort((a, b) => a.hour.localeCompare(b.hour))
      .map((r) => ({
        ...r,
        label: new Date(r.hour).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }),
      }));
  })();

  const statusData = Object.entries(stats.assetsByStatus).map(([name, value]) => ({
    name,
    value,
    color: STATUS_COLORS[name] || "#71717a",
  }));

  const dbTypeData = Object.entries(stats.assetsByDbType).map(([name, value]) => ({
    name,
    value,
    color: DB_TYPE_COLORS[name] || "#71717a",
  }));

  const severityData = ["CRITICAL", "HIGH", "MEDIUM", "LOW"]
    .filter((s) => (stats.alertsBySeverity[s] || 0) > 0)
    .map((s) => ({
      name: s,
      value: stats.alertsBySeverity[s],
      color: SEVERITY_COLORS[s],
    }));

  // Compute Security Health Score (0-100)
  // Formula: 100 baseline - critical alerts (×15) - failed logins (×0.5) + online assets bonus
  const totalFailed = stats.serverFailedToday + stats.dbFailedToday;
  const healthScore = Math.max(
    0,
    Math.min(
      100,
      100 -
        stats.criticalAlerts * 15 -
        stats.openAlerts * 5 -
        Math.min(30, totalFailed * 0.5) +
        (stats.onlineAgents > 0 ? 5 : 0)
    )
  );
  const healthLabel =
    healthScore >= 90 ? "Excellent" :
    healthScore >= 75 ? "Good" :
    healthScore >= 50 ? "Fair" :
    healthScore >= 25 ? "At Risk" : "Critical";
  const healthColor =
    healthScore >= 75 ? "#10b981" :
    healthScore >= 50 ? "#f59e0b" :
    healthScore >= 25 ? "#f97316" : "#ef4444";

  return (
    <>
    <DashboardTabs activeTab={activeTab} onTabChange={setActiveTab} />

    <div className="space-y-6">
      {/* Header */}
      <FadeIn className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Security Overview
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Real-time monitoring dari semua server &amp; database yang lo kelola
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-3">
          {/* Security Health Score badge */}
          <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5">
            <div
              className="h-7 w-7 rounded-md flex items-center justify-center font-mono font-bold text-[11px]"
              style={{
                backgroundColor: `${healthColor}15`,
                border: `1px solid ${healthColor}40`,
                color: healthColor,
              }}
            >
              {healthScore}
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] text-[var(--muted-foreground)] uppercase tracking-wider leading-none">
                Health
              </span>
              <span className="text-[11px] font-semibold leading-tight" style={{ color: healthColor }}>
                {healthLabel}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--muted-foreground)]">
            <PulseDot color="success" />
            LIVE
          </div>
        </div>
      </FadeIn>

      {/* Welcome / Get Started banner — shown to first-time users with 0 assets */}
      {stats.totalAgents === 0 && (
        <FadeIn delay={0.05}>
          <div className="relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/[0.08] via-emerald-500/[0.02] to-transparent p-6 sm:p-8">
            <div className="absolute top-0 right-0 w-64 h-64 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
            <div className="absolute -top-4 -right-4 opacity-20">
              <ShieldCheck className="h-32 w-32 text-emerald-500" strokeWidth={1} />
            </div>
            <div className="relative max-w-2xl">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-semibold tracking-[0.2em] uppercase text-emerald-400 mb-3">
                <Sparkles className="h-3 w-3" />
                Welcome to OpenShield
              </div>
              <h2 className="text-xl sm:text-2xl font-semibold tracking-tight mb-2">
                Mulai monitor infrastructure lo dalam 60 detik 🚀
              </h2>
              <p className="text-sm text-[var(--muted-foreground)] mb-5 max-w-lg">
                OpenShield bakal otomatis detect SSH login (auth.log) & database login events.
                Install agent pertama lo di server yg mau dimonitor — cukup satu command curl, langsung jalan.
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                <a
                  href="/dashboard/agents"
                  className="inline-flex items-center gap-2 h-10 px-5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 text-sm font-medium transition-all"
                >
                  <Plus className="h-4 w-4" strokeWidth={2.5} />
                  Install Agent Pertama
                  <ArrowRight className="h-3.5 w-3.5 opacity-60" />
                </a>
                <a
                  href="/dashboard/analysis"
                  className="inline-flex items-center gap-2 h-10 px-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm font-medium hover:bg-white/[0.04] transition-all"
                >
                  Lihat Demo Dashboard
                </a>
              </div>
              <div className="mt-5 flex items-center gap-4 sm:gap-6 text-[11px] text-[var(--muted-foreground)]">
                <div className="flex items-center gap-1.5">
                  <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Zero config SSH
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                  MySQL/Postgres/SQL Server
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-1.5 w-1.5 rounded-full bg-purple-500" />
                  Real-time threat detection
                </div>
              </div>
            </div>
          </div>
        </FadeIn>
      )}

      {/* Stat cards row: 4 key metrics */}
      <StaggerContainer className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4" staggerDelay={0.06}>
        <StaggerItem>
          <StatCard
            label="Active Agents"
            value={stats.onlineAgents}
            sub={`${stats.totalAgents} total`}
            icon={Server}
            trend="neutral"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Server Auth Today"
            value={totalServerAuth}
            sub={`${stats.serverSuccessToday} ✓ / ${stats.serverFailedToday} ✗`}
            icon={Activity}
            trend="neutral"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="DB Logins Today"
            value={totalDbAuth}
            sub={`${stats.dbSuccessToday} ✓ / ${stats.dbFailedToday} ✗`}
            icon={Database}
            trend="neutral"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Open Alerts"
            value={stats.openAlerts}
            sub={stats.criticalAlerts > 0 ? `${stats.criticalAlerts} critical` : "all resolved"}
            icon={AlertTriangle}
            trend={stats.criticalAlerts > 0 ? "up" : "down"}
          />
        </StaggerItem>
      </StaggerContainer>

      {/* Time series chart — moved to TOP for first-impression impact */}
      <ChartReveal className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6" delay={0.2}>
        <SectionHeader
          title="Auth Events — Last 24h"
          sub="Per-jam, success vs failed (SSH + DB)"
          action={{ label: "View all events", href: "/dashboard/server" }}
        />
        {mergedTs.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center">
            <Activity className="h-8 w-8 text-[var(--muted-foreground)] mb-2" strokeWidth={1.5} />
            <div className="text-sm text-[var(--muted-foreground)]">
              No events in the last 24h
            </div>
            <div className="text-xs text-[var(--muted-foreground)] mt-1">
              Connect an asset to start monitoring
            </div>
          </div>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={mergedTs} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="serverSucc" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="serverFail" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="dbSucc" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="dbFail" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  axisLine={{ stroke: "var(--border)" }}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip {...tooltipStyle} cursor={{ stroke: "rgba(255,255,255,0.1)" }} />
                <Legend
                  wrapperStyle={{ fontSize: 11, paddingTop: 10 }}
                  iconType="circle"
                />
                <Area type="monotone" dataKey="sshSuccess" name="SSH ✓" stroke="#10b981" strokeWidth={1.5} fill="url(#serverSucc)" />
                <Area type="monotone" dataKey="sshFailed" name="SSH ✗" stroke="#ef4444" strokeWidth={1.5} fill="url(#serverFail)" />
                <Area type="monotone" dataKey="dbSuccess" name="DB ✓" stroke="#3b82f6" strokeWidth={1.5} fill="url(#dbSucc)" />
                <Area type="monotone" dataKey="dbFailed" name="DB ✗" stroke="#f59e0b" strokeWidth={1.5} fill="url(#dbFail)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </ChartReveal>

      {/* Environment breakdown */}
      <StaggerContainer className="grid grid-cols-3 gap-3" staggerDelay={0.04}>
        {([
          { id: "PROD", label: "Production", color: "#ef4444", icon: Globe },
          { id: "STAGING", label: "Staging", color: "#f97316", icon: Globe },
          { id: "UAT", label: "UAT", color: "#3b82f6", icon: Globe },
        ] as const).map((env) => {
          const count = stats.assetsByEnvironment[env.id] || 0;
          const Icon = env.icon;
          return (
            <StaggerItem key={env.id}>
              <div
                className="rounded-xl border bg-[var(--surface)] p-4 relative overflow-hidden transition-all hover:border-opacity-60"
                style={{ borderColor: `${env.color}30` }}
              >
                <div
                  className="absolute top-0 right-0 w-20 h-20 rounded-full opacity-10 blur-2xl"
                  style={{ backgroundColor: env.color }}
                />
                <div className="relative">
                  <div className="flex items-center justify-between mb-2">
                    <div
                      className="h-7 w-7 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: `${env.color}15`, border: `1px solid ${env.color}40` }}
                    >
                      <Icon className="h-3.5 w-3.5" strokeWidth={2} style={{ color: env.color }} />
                    </div>
                    <span
                      className="text-[9px] font-mono font-semibold tracking-wider"
                      style={{ color: env.color }}
                    >
                      {env.id}
                    </span>
                  </div>
                  <div className="text-2xl font-semibold font-mono tabular-nums">
                    {count}
                  </div>
                  <div className="text-[10px] text-[var(--muted-foreground)] mt-0.5">
                    {env.label} {count === 1 ? "asset" : "assets"}
                  </div>
                </div>
              </div>
            </StaggerItem>
          );
        })}
      </StaggerContainer>

      {/* Two-column: Top attackers + Status/DB type distribution */}
      <StaggerContainer className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6" staggerDelay={0.1}>
        {/* Top SSH attackers */}
        <StaggerItem>
        <motion.div whileHover={{ y: -2 }} transition={{ type: "spring", stiffness: 400, damping: 25 }} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6 h-full">
          <SectionHeader
            title="Top Server Activity"
            sub="Failed logins, 7 days"
          />
          {stats.topSshAttackers.length === 0 ? (
            <div className="text-center py-8 text-xs text-[var(--muted-foreground)]">
              <ShieldAlert className="h-6 w-6 mx-auto mb-2 opacity-50" strokeWidth={1.5} />
              No failed attempts 🎉
            </div>
          ) : (
            <div className="space-y-2.5">
              {stats.topSshAttackers.slice(0, 8).map((row, i) => (
                <div key={row.ip} className="flex items-center gap-3">
                  <div className="w-5 text-[10px] font-mono text-[var(--muted-foreground)] tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1 gap-2">
                      <code className="text-[11px] font-mono text-[var(--foreground)] truncate">
                        {row.ip}
                      </code>
                      <span className="text-[11px] font-semibold tabular-nums text-[var(--danger)] shrink-0">
                        {row.count}
                      </span>
                    </div>
                    <div className="h-1 bg-white/[0.04] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[var(--danger)] to-orange-500 rounded-full"
                        style={{
                          width: `${(row.count / stats.topSshAttackers[0].count) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </motion.div>
        </StaggerItem>

        {/* Top DB attackers */}
        <StaggerItem>
        <motion.div whileHover={{ y: -2 }} transition={{ type: "spring", stiffness: 400, damping: 25 }} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6 h-full">
          <SectionHeader
            title="Top DB Attackers"
            sub="Failed logins, 7 days"
          />
          {stats.topDbAttackers.length === 0 ? (
            <div className="text-center py-8 text-xs text-[var(--muted-foreground)]">
              <Database className="h-6 w-6 mx-auto mb-2 opacity-50" strokeWidth={1.5} />
              No failed DB logins 🎉
            </div>
          ) : (
            <div className="space-y-2.5">
              {stats.topDbAttackers.slice(0, 8).map((row, i) => (
                <div key={`${row.ip}-${row.dbType}`} className="flex items-center gap-3">
                  <div className="w-5 text-[10px] font-mono text-[var(--muted-foreground)] tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1 gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <code className="text-[11px] font-mono text-[var(--foreground)] truncate">
                          {row.ip}
                        </code>
                        <span
                          className="text-[8px] font-mono uppercase px-1 py-0.5 rounded"
                          style={{
                            color: DB_TYPE_COLORS[row.dbType] || "#71717a",
                            backgroundColor: `${DB_TYPE_COLORS[row.dbType]}15`,
                          }}
                        >
                          {row.dbType}
                        </span>
                      </div>
                      <span className="text-[11px] font-semibold tabular-nums text-[var(--danger)] shrink-0">
                        {row.count}
                      </span>
                    </div>
                    <div className="h-1 bg-white/[0.04] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[var(--danger)] to-orange-500 rounded-full"
                        style={{
                          width: `${(row.count / stats.topDbAttackers[0].count) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </motion.div>
        </StaggerItem>

        {/* Asset status pie */}
        <StaggerItem>
        <motion.div whileHover={{ y: -2 }} transition={{ type: "spring", stiffness: 400, damping: 25 }} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6 h-full">
          <SectionHeader
            title="Asset Status"
            sub={`${stats.totalAgents} total`}
          />
          {statusData.length === 0 ? (
            <div className="text-center py-8 text-xs text-[var(--muted-foreground)]">
              <Server className="h-6 w-6 mx-auto mb-2 opacity-50" strokeWidth={1.5} />
              No assets yet
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <div className="h-32 w-32 shrink-0 relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusData}
                      cx="50%"
                      cy="50%"
                      innerRadius={35}
                      outerRadius={55}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {statusData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} stroke="none" />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-xl font-semibold tabular-nums">{stats.totalAgents}</div>
                    <div className="text-[9px] uppercase tracking-wider text-[var(--muted-foreground)]">
                      Total
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex-1 space-y-1.5">
                {statusData.map((s) => (
                  <div key={s.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: s.color }}
                      />
                      <span className="text-[var(--muted-foreground)]">{s.name}</span>
                    </div>
                    <span className="font-mono tabular-nums">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
        </StaggerItem>
      </StaggerContainer>

      {/* DB type + Severity + Recent activity */}
      <StaggerContainer className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6" staggerDelay={0.1}>
        {/* DB Type distribution */}
        <StaggerItem>
        <motion.div whileHover={{ y: -2 }} transition={{ type: "spring", stiffness: 400, damping: 25 }} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6 h-full">
          <SectionHeader title="Database Types" sub="Connected DBs" />
          {dbTypeData.length === 0 ? (
            <div className="text-center py-8 text-xs text-[var(--muted-foreground)]">
              <Database className="h-6 w-6 mx-auto mb-2 opacity-50" strokeWidth={1.5} />
              No databases connected
            </div>
          ) : (
            <div className="space-y-3">
              {dbTypeData.map((d) => (
                <div key={d.name}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: d.color }}
                      />
                      <span className="font-medium">{d.name}</span>
                    </div>
                    <span className="font-mono tabular-nums text-[var(--muted-foreground)]">
                      {d.value}
                    </span>
                  </div>
                  <div className="h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(d.value / Math.max(...dbTypeData.map((x) => x.value))) * 100}%`,
                        backgroundColor: d.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </motion.div>
        </StaggerItem>

        {/* Alert severity */}
        <StaggerItem>
        <motion.div whileHover={{ y: -2 }} transition={{ type: "spring", stiffness: 400, damping: 25 }} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6 h-full">
          <SectionHeader
            title="Alert Severity"
            sub="Open alerts"
            action={{ label: "View all", href: "/dashboard/alerts" }}
          />
          {severityData.length === 0 ? (
            <div className="text-center py-8 text-xs text-[var(--muted-foreground)]">
              <CheckCircle2 className="h-6 w-6 mx-auto mb-2 opacity-50" strokeWidth={1.5} />
              No open alerts
            </div>
          ) : (
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={severityData} layout="vertical" margin={{ left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                    width={60}
                  />
                  <Tooltip {...tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {severityData.map((s, i) => (
                      <Cell key={i} fill={s.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </motion.div>
        </StaggerItem>

        {/* Recent activity feed */}
        <StaggerItem>
        <motion.div whileHover={{ y: -2 }} transition={{ type: "spring", stiffness: 400, damping: 25 }} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6 h-full">
          <SectionHeader
            title="Recent Activity"
            sub="Latest 8 events"
            action={{ label: "All events", href: "/dashboard/server" }}
          />
          <div className="space-y-2 -mx-1">
            {[
              ...stats.recentSsh.map((e) => ({ ...e, kind: "ssh" as const })),
              ...stats.recentDb.map((e) => ({ ...e, kind: "db" as const })),
            ]
              .sort((a, b) => b.eventTime.localeCompare(a.eventTime))
              .slice(0, 8)
              .map((e) => {
                const isDb = e.kind === "db";
                const dbType = isDb ? (e as { dbType: string }).dbType : null;
                const isFailed = e.status !== "SUCCESS";
                return (
                  <motion.div
                    key={e.id}
                    whileHover={{ x: 2 }}
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.03] transition-colors"
                  >
                    {isFailed ? (
                      <PulseDot color="danger" size="sm" ping={false} />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-[var(--success)]" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] truncate">
                        <span className="font-mono">{e.username}</span>
                        <span className="text-[var(--muted-foreground)]"> @ </span>
                        <span className="font-medium">{e.hostname}</span>
                        {isDb && dbType && (
                          <span className="text-[var(--muted-foreground)]">
                            {" "}
                            ({dbType})
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-[var(--muted-foreground)] flex items-center gap-1.5 mt-0.5">
                        <code className="font-mono">{e.sourceIp}</code>
                        <span>·</span>
                        <Clock className="h-2.5 w-2.5" />
                        <span>{formatRelativeTime(e.eventTime)}</span>
                      </div>
                    </div>
                    <span
                      className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded ${
                        isFailed
                          ? "bg-[var(--danger)]/10 text-[var(--danger)]"
                          : "bg-[var(--success)]/10 text-[var(--success)]"
                      }`}
                    >
                      {isFailed ? "fail" : "ok"}
                    </span>
                  </motion.div>
                );
              })}
            {stats.recentSsh.length === 0 && stats.recentDb.length === 0 && (
              <div className="text-center py-6 text-xs text-[var(--muted-foreground)]">
                No recent activity
              </div>
            )}
          </div>
        </motion.div>
        </StaggerItem>
      </StaggerContainer>
    </div>
    </>
  );
}
