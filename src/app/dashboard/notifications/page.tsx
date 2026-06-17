"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  BellRing,
  AlertTriangle,
  ShieldAlert,
  Info,
  Check,
  CheckCheck,
  X,
} from "lucide-react";

type Notification = {
  id: string;
  type: "alert" | "audit";
  title: string;
  description: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "INFO";
  action: "acknowledge_alert" | null;
  resourceId: string | null;
  createdAt: string;
};

const SEVERITY_META: Record<Notification["severity"], { color: string; bg: string; label: string; icon: React.ComponentType<{ className?: string }> }> = {
  CRITICAL: { color: "text-[var(--danger)]", bg: "bg-[var(--danger)]/10", label: "Critical", icon: ShieldAlert },
  HIGH: { color: "text-[var(--danger)]", bg: "bg-[var(--danger)]/10", label: "High", icon: AlertTriangle },
  MEDIUM: { color: "text-[var(--warning)]", bg: "bg-[var(--warning)]/10", label: "Medium", icon: AlertTriangle },
  LOW: { color: "text-[var(--info)]", bg: "bg-[var(--info)]/10", label: "Low", icon: Info },
  INFO: { color: "text-[var(--muted-foreground)]", bg: "bg-white/[0.04]", label: "Info", icon: Info },
};

const TYPE_LABEL: Record<Notification["type"], string> = {
  alert: "Alert",
  audit: "Activity",
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function formatFull(iso: string) {
  return new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "alert" | "audit">("all");
  const [acknowledging, setAcknowledging] = useState<Set<string>>(new Set());

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/notifications?limit=100", { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      setItems(d.notifications || []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  async function markRead(ids: string[]) {
    if (ids.length === 0) return;
    setAcknowledging((prev) => new Set([...prev, ...ids]));
    try {
      await fetch("/api/notifications/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      // Refresh after acknowledge
      await fetchNotifications();
    } finally {
      setAcknowledging((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    }
  }

  async function markAllRead() {
    const ids = items.filter((i) => i.type === "alert").map((i) => i.id);
    await markRead(ids);
  }

  const filtered = items.filter((n) => filter === "all" || n.type === filter);
  const alertCount = items.filter((i) => i.type === "alert").length;
  const auditCount = items.filter((i) => i.type === "audit").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Notifications
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            {items.length === 0
              ? "Belum ada notifikasi"
              : `${items.length} total · ${alertCount} alert · ${auditCount} activity`}
          </p>
        </div>
        {alertCount > 0 && (
          <button
            onClick={markAllRead}
            className="flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[var(--accent)] text-black hover:bg-[var(--accent)]/90 text-sm font-medium transition-all glow-emerald"
          >
            <CheckCheck className="h-4 w-4" />
            Acknowledge all alerts
          </button>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.03] border border-[var(--border)] w-fit">
        {[
          { id: "all", label: "All", count: items.length },
          { id: "alert", label: "Alerts", count: alertCount },
          { id: "audit", label: "Activity", count: auditCount },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setFilter(t.id as typeof filter)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              filter === t.id
                ? "bg-white text-black shadow-sm"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            }`}
          >
            {t.label}
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                filter === t.id
                  ? "bg-black/10 text-black/70"
                  : "bg-white/[0.04] text-[var(--muted-foreground)]"
              }`}
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-12 text-center">
          <div className="text-sm text-[var(--muted-foreground)]">Loading…</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-[var(--border-strong)] p-12 text-center">
          <BellRing
            className="h-10 w-10 text-[var(--muted-foreground)] mx-auto"
            strokeWidth={1.5}
          />
          <h3 className="mt-4 text-sm font-semibold">No notifications</h3>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            {filter === "all"
              ? "Lo bersih-bersih bro. Semua alert udah di-acknowledge."
              : `Tidak ada ${TYPE_LABEL[filter as Notification["type"]].toLowerCase()} di sistem lo`}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          {filtered.map((n, idx) => {
            const meta = SEVERITY_META[n.severity] || SEVERITY_META.INFO;
            const Icon = meta.icon;
            const isAcknowledging = acknowledging.has(n.id);
            return (
              <motion.div
                key={n.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(idx * 0.02, 0.3) }}
                className={`px-4 py-3.5 border-b border-[var(--border)] last:border-0 hover:bg-white/[0.02] transition-colors ${
                  n.type === "alert" ? "bg-[var(--accent-soft)]/[0.15]" : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`shrink-0 h-9 w-9 rounded-lg ${meta.bg} flex items-center justify-center`}>
                    <Icon className={`h-4 w-4 ${meta.color}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded ${meta.bg} ${meta.color}`}
                      >
                        {meta.label}
                      </span>
                      <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/[0.04] text-[var(--muted-foreground)]">
                        {TYPE_LABEL[n.type]}
                      </span>
                      <span className="text-[10px] font-mono text-[var(--muted-foreground)]">
                        {timeAgo(n.createdAt)}
                      </span>
                    </div>
                    <div className="mt-1.5 text-sm font-medium">{n.title}</div>
                    <div className="mt-0.5 text-xs text-[var(--muted-foreground)] line-clamp-2">
                      {n.description}
                    </div>
                    <div className="mt-1 text-[10px] font-mono text-[var(--muted-foreground)] opacity-60">
                      {formatFull(n.createdAt)}
                    </div>
                  </div>
                  {n.action === "acknowledge_alert" && (
                    <button
                      onClick={() => markRead([n.id])}
                      disabled={isAcknowledging}
                      className="shrink-0 flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-medium border border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--accent)]/20 disabled:opacity-50 transition-colors"
                    >
                      <Check className="h-3 w-3" />
                      {isAcknowledging ? "…" : "Ack"}
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {filtered.length > 0 && (
        <div className="text-[10px] text-[var(--muted-foreground)] font-mono">
          Showing {filtered.length} of {items.length} notifications
        </div>
      )}
    </div>
  );
}
