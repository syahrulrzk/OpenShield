"use client";

import { useEffect, useState } from "react";
import {
  Loader2,
  TrendingUp,
  Globe,
  Server,
  ShieldAlert,
  Activity,
  Calendar,
  Clock,
  BarChart3,
  UserCheck,
  KeyRound,
  ArrowUpRight,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  AreaChart,
  Area,
  Legend,
} from "recharts";

type Analysis = {
  period: { days: number; since: string };
  totals: { ssh: number; db: number; failed: number };
  daySeries: { day: string; sshSuccess: number; sshFailed: number; dbSuccess: number; dbFailed: number }[];
  topSshAttackers: { ip: string; count: number }[];
  topDbAttackers: { ip: string; count: number }[];
  topUsernames: { username: string; ssh: number; db: number; total: number }[];
  topAssets: { hostname: string; events: number; failed: number }[];
  topSuccessUsers: { username: string; assets: { hostname: string; count: number; lastSeen: string }[]; total: number }[];
  statusBreakdown: Record<string, number>;
  hourlyHeatmap: { dow: number; hour: number; count: number }[];
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

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function AnalysisClient() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/reports/analysis?days=${days}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [days]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-[var(--muted-foreground)]">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading analysis...
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-4 text-sm text-[var(--danger)]">
        {error}
      </div>
    );
  }
  if (!data) return null;

  const successRate =
    data.totals.ssh + data.totals.db > 0
      ? (
          ((data.totals.ssh + data.totals.db - data.totals.failed) /
            (data.totals.ssh + data.totals.db)) *
          100
        ).toFixed(1)
      : "100";

  // Build heatmap matrix [7 days × 24 hours]
  const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const h of data.hourlyHeatmap) {
    if (h.dow >= 0 && h.dow < 7 && h.hour >= 0 && h.hour < 24) {
      heatmap[h.dow][h.hour] = h.count;
    }
  }
  const maxHeat = Math.max(1, ...heatmap.flat());

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight flex items-center gap-2">
          <BarChart3 className="h-6 w-6" />
          Security Analysis
        </h1>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Trends, top attackers, success patterns dari {data.period.days} hari terakhir
        </p>
      </div>

      {/* Period selector */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-xs text-[var(--muted-foreground)]">
          Analyzing <span className="text-[var(--foreground)] font-mono">{data.totals.ssh + data.totals.db}</span> events
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          {[1, 7, 14, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`h-8 px-3 rounded-lg text-xs font-mono transition-colors ${
                days === d
                  ? "bg-white text-black font-semibold"
                  : "border border-[var(--border)] hover:bg-white/[0.04]"
              }`}
            >
              {d === 1 ? "24h" : `${d}d`}
            </button>
          ))}
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Total Events" value={data.totals.ssh + data.totals.db} icon={Activity} />
        <StatBox label="Failed Attempts" value={data.totals.failed} icon={ShieldAlert} accent="danger" />
        <StatBox label="Success Rate" value={`${successRate}%`} icon={TrendingUp} accent="success" />
        <StatBox
          label="Top Attacker"
          value={data.topSshAttackers[0]?.ip || data.topDbAttackers[0]?.ip || "—"}
          icon={Globe}
          sub={
            data.topSshAttackers[0]?.count || data.topDbAttackers[0]?.count
              ? `${data.topSshAttackers[0]?.count ?? data.topDbAttackers[0]?.count ?? 0} attempts`
              : "none"
          }
          mono
        />
      </div>

      {/* Daily trend */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="h-4 w-4 text-[var(--muted-foreground)]" />
          <h3 className="text-sm font-semibold">Daily Events Trend</h3>
        </div>
        {data.daySeries.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-xs text-[var(--muted-foreground)]">
            No data in this period
          </div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.daySeries} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="aSucc" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="aFail" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  axisLine={{ stroke: "var(--border)" }}
                  tickLine={false}
                  tickFormatter={(v) =>
                    new Date(v).toLocaleDateString("id-ID", { day: "2-digit", month: "short" })
                  }
                />
                <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <Tooltip {...tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                <Area type="monotone" dataKey="sshSuccess" name="SSH ✓" stroke="#10b981" fill="url(#aSucc)" strokeWidth={1.5} />
                <Area type="monotone" dataKey="sshFailed" name="SSH ✗" stroke="#ef4444" fill="url(#aFail)" strokeWidth={1.5} />
                <Area type="monotone" dataKey="dbSuccess" name="DB ✓" stroke="#3b82f6" fill="url(#aSucc)" strokeWidth={1.5} />
                <Area type="monotone" dataKey="dbFailed" name="DB ✗" stroke="#f59e0b" fill="url(#aFail)" strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* 🆕 Top Users Successful Access */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex items-center gap-2 mb-4">
          <UserCheck className="h-4 w-4 text-[var(--success)]" />
          <h3 className="text-sm font-semibold">Top Users dengan Successful Access</h3>
          <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--success)]/10 text-[var(--success)] border border-[var(--success)]/30">
            ✓ verified
          </span>
        </div>
        {data.topSuccessUsers.length === 0 ? (
          <div className="text-center py-6 text-xs text-[var(--muted-foreground)]">
            Belum ada successful login events
          </div>
        ) : (
          <div className="space-y-3">
            {data.topSuccessUsers.map((u, i) => (
              <div
                key={u.username}
                className="rounded-lg border border-[var(--border)] bg-white/[0.02] p-3 hover:bg-white/[0.04] transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-6 h-6 rounded-md bg-white text-black flex items-center justify-center text-[10px] font-bold font-mono">
                      {String(i + 1).padStart(2, "0")}
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      <KeyRound className="h-3.5 w-3.5 text-[var(--success)] shrink-0" />
                      <code className="text-xs font-mono font-semibold truncate">{u.username}</code>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-mono shrink-0">
                    <span className="text-[var(--success)] font-semibold">{u.total} successful</span>
                    <span className="text-[var(--muted-foreground)]">·</span>
                    <span className="text-[var(--muted-foreground)]">{u.assets.length} server{u.assets.length !== 1 ? "s" : ""}</span>
                  </div>
                </div>
                <div className="space-y-1 pl-8">
                  {u.assets.slice(0, 3).map((a) => (
                    <div
                      key={a.hostname}
                      className="flex items-center justify-between text-[10px] font-mono"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <ArrowUpRight className="h-2.5 w-2.5 text-[var(--success)] shrink-0" />
                        <span className="text-[var(--muted-foreground)] truncate">{a.hostname}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 tabular-nums">
                        <span className="text-[var(--success)]">{a.count}×</span>
                        <span className="text-[var(--muted-foreground)] opacity-60">
                          {new Date(a.lastSeen).toLocaleDateString("id-ID", { day: "2-digit", month: "short" })}
                        </span>
                      </div>
                    </div>
                  ))}
                  {u.assets.length > 3 && (
                    <div className="text-[10px] text-[var(--muted-foreground)] pl-4">
                      +{u.assets.length - 3} more server{u.assets.length - 3 !== 1 ? "s" : ""}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Top attackers + Top assets */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <ShieldAlert className="h-4 w-4 text-[var(--danger)]" />
            <h3 className="text-sm font-semibold">Top 20 Attacker IPs</h3>
          </div>
          {data.topSshAttackers.length === 0 && data.topDbAttackers.length === 0 ? (
            <div className="text-center py-6 text-xs text-[var(--muted-foreground)]">
              No failed attempts
            </div>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={[...data.topSshAttackers, ...data.topDbAttackers]
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 10)}
                  layout="vertical"
                  margin={{ left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="ip"
                    tick={{ fontSize: 9, fill: "var(--muted-foreground)", fontFamily: "monospace" }}
                    axisLine={false}
                    tickLine={false}
                    width={110}
                  />
                  <Tooltip {...tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                  <Bar dataKey="count" fill="#ef4444" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <Server className="h-4 w-4 text-[var(--info)]" />
            <h3 className="text-sm font-semibold">Top Targeted Assets</h3>
          </div>
          {data.topAssets.length === 0 ? (
            <div className="text-center py-6 text-xs text-[var(--muted-foreground)]">
              No assets
            </div>
          ) : (
            <div className="space-y-2.5">
              {data.topAssets.map((a, i) => (
                <div key={a.hostname} className="flex items-center gap-3">
                  <div className="w-5 text-[10px] font-mono text-[var(--muted-foreground)]">
                    {String(i + 1).padStart(2, "0")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1 gap-2">
                      <code className="text-[11px] font-mono truncate">{a.hostname}</code>
                      <div className="flex items-center gap-2 text-[10px] font-mono tabular-nums shrink-0">
                        <span className="text-[var(--foreground)]">{a.events}</span>
                        {a.failed > 0 && (
                          <span className="text-[var(--danger)]">({a.failed} fail)</span>
                        )}
                      </div>
                    </div>
                    <div className="h-1 bg-white/[0.04] rounded-full overflow-hidden flex">
                      <div
                        className="bg-[var(--info)]"
                        style={{
                          width: `${(a.events / Math.max(...data.topAssets.map((x) => x.events))) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top usernames + Heatmap */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="h-4 w-4 text-[var(--warning)]" />
            <h3 className="text-sm font-semibold">Top 20 Targeted Usernames</h3>
          </div>
          {data.topUsernames.length === 0 ? (
            <div className="text-center py-6 text-xs text-[var(--muted-foreground)]">
              No data
            </div>
          ) : (
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {data.topUsernames.map((u, i) => (
                <div
                  key={u.username}
                  className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-white/[0.02]"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-5 text-[10px] font-mono text-[var(--muted-foreground)]">
                      {String(i + 1).padStart(2, "0")}
                    </div>
                    <code className="text-[11px] font-mono truncate">{u.username}</code>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-mono tabular-nums shrink-0">
                    {u.ssh > 0 && (
                      <span className="text-[var(--success)]">{u.ssh} SSH</span>
                    )}
                    {u.db > 0 && (
                      <span className="text-[var(--info)]">{u.db} DB</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="h-4 w-4 text-[var(--muted-foreground)]" />
            <h3 className="text-sm font-semibold">Activity Heatmap (Day × Hour)</h3>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[500px]">
              <div className="grid grid-cols-[40px_repeat(24,1fr)] gap-0.5 text-[9px]">
                <div></div>
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="text-center text-[var(--muted-foreground)] font-mono">
                    {h}
                  </div>
                ))}
                {heatmap.map((row, dow) => (
                  <HeatRow key={dow} dow={dow} row={row} maxHeat={maxHeat} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeatRow({ dow, row, maxHeat }: { dow: number; row: number[]; maxHeat: number }) {
  return (
    <>
      <div className="text-[var(--muted-foreground)] font-mono text-right pr-2">
        {DOW_LABELS[dow]}
      </div>
      {row.map((count, hour) => (
        <div
          key={`${dow}-${hour}`}
          className="aspect-square rounded-sm"
          style={{
            backgroundColor:
              count === 0
                ? "rgba(255,255,255,0.02)"
                : `rgba(239, 68, 68, ${Math.min(0.95, 0.2 + (count / maxHeat) * 0.75)})`,
          }}
          title={`${DOW_LABELS[dow]} ${hour}:00 — ${count} events`}
        />
      ))}
    </>
  );
}

function StatBox({
  label,
  value,
  sub,
  icon: Icon,
  accent = "default",
  mono = false,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: "default" | "success" | "danger";
  mono?: boolean;
}) {
  const accentColor =
    accent === "success"
      ? "text-[var(--success)]"
      : accent === "danger"
        ? "text-[var(--danger)]"
        : "text-[var(--foreground)]";
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-center justify-between mb-2">
        <Icon className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
      </div>
      <div className={`text-xl font-semibold tabular-nums ${mono ? "font-mono text-base" : ""} ${accentColor}`}>
        {value}
      </div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted-foreground)] mt-1">
        {label}
      </div>
      {sub && <div className="text-[10px] text-[var(--muted)] mt-0.5">{sub}</div>}
    </div>
  );
}
