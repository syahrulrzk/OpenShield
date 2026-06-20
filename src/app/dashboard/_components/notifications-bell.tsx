"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { BellRing, AlertTriangle, ShieldAlert, Info, Check, X } from "lucide-react";

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

const SEVERITY_META: Record<Notification["severity"], { color: string; bg: string; icon: React.ComponentType<{ className?: string }> }> = {
  CRITICAL: { color: "text-[var(--danger)]", bg: "bg-[var(--danger)]/10", icon: ShieldAlert },
  HIGH: { color: "text-[var(--danger)]", bg: "bg-[var(--danger)]/10", icon: AlertTriangle },
  MEDIUM: { color: "text-[var(--warning)]", bg: "bg-[var(--warning)]/10", icon: AlertTriangle },
  LOW: { color: "text-[var(--info)]", bg: "bg-[var(--info)]/10", icon: Info },
  INFO: { color: "text-[var(--muted-foreground)]", bg: "bg-white/[0.04]", icon: Info },
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Track which notification IDs have been marked read on this device.
  // Persisted in localStorage so it survives reloads (until items age out).
  const READ_KEY = "os:notif:read-ids:v1";

  function getReadIds(): Set<string> {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.localStorage.getItem(READ_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  }

  function markReadPersistent(ids: string[]) {
    if (typeof window === "undefined") return;
    try {
      const cur = getReadIds();
      ids.forEach((id) => cur.add(id));
      // Keep at most last 500 IDs (avoid unbounded growth)
      const arr = Array.from(cur);
      const trimmed = arr.slice(-500);
      window.localStorage.setItem(READ_KEY, JSON.stringify(trimmed));
    } catch {
      // localStorage may be full/disabled — silent fallback
    }
  }

  async function fetchNotifications() {
    setLoading(true);
    try {
      const r = await fetch("/api/notifications?limit=8", { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      const all: Notification[] = d.notifications || [];
      const readIds = getReadIds();
      // Filter out items already marked read on this device.
      // Users expect "Mark all read" → empty list, not dimmed list.
      const unread = all.filter((n) => !readIds.has(n.id));
      setItems(unread);
      setUnread(unread.length);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  async function markAllRead() {
    const allIds = items.map((i) => i.id);
    if (allIds.length === 0) return;

    // Persist read state locally so it survives reloads.
    // (Audit log is append-only on the server; alert status is updated via API.)
    markReadPersistent(allIds);

    // Best-effort: try to acknowledge server-side alerts.
    // Audit items are no-op on server (immutable), but alerts get updated.
    try {
      await fetch("/api/notifications/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: allIds }),
      });
    } catch {
      // silent — local persistence is the source of truth for UI
    }

    // Clear list immediately: items are persisted as read, so next fetch
    // will filter them out. Users expect "Mark all read" → empty list.
    setItems([]);
    setUnread(0);
  }

  return (
    <div className="relative z-40" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative h-9 w-9 rounded-lg border border-[var(--border)] hover:border-[var(--accent-border)] hover:bg-white/[0.04] flex items-center justify-center text-[var(--muted)] hover:text-[var(--accent)] transition-all active:scale-95 cursor-pointer"
        aria-label="Notifications"
        style={{ pointerEvents: "auto", zIndex: 60 }}
      >
        <BellRing className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--danger)] text-[9px] font-bold text-white flex items-center justify-center shadow-[0_0_10px_rgba(239,68,68,0.5)]">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.96 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute right-0 top-full mt-2 w-96 max-w-[calc(100vw-2rem)] rounded-xl border border-[var(--border-strong)] bg-[var(--background)] shadow-2xl overflow-hidden z-50"
            style={{
              backgroundImage:
                "linear-gradient(rgba(16,185,129,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(16,185,129,0.04) 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--background)]/95 backdrop-blur">
              <div className="flex items-center gap-2">
                <BellRing className="h-4 w-4 text-[var(--accent)]" />
                <h3 className="text-sm font-semibold">Notifications</h3>
                {unread > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] font-mono">
                    {unread}
                  </span>
                )}
              </div>
              {unread > 0 && (
                <button
                  onClick={markAllRead}
                  className="flex items-center gap-1 text-[11px] text-[var(--muted-foreground)] hover:text-[var(--accent)] transition-colors"
                >
                  <Check className="h-3 w-3" />
                  Mark all read
                </button>
              )}
            </div>

            {/* List */}
            <div className="max-h-[420px] overflow-y-auto">
              {loading && items.length === 0 ? (
                <div className="px-4 py-12 text-center text-xs text-[var(--muted-foreground)]">
                  Loading…
                </div>
              ) : items.length === 0 ? (
                <div className="px-4 py-12 text-center">
                  <BellRing className="h-8 w-8 text-[var(--muted-foreground)] opacity-40 mx-auto" />
                  <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                    No notifications
                  </p>
                </div>
              ) : (
                items.map((n) => {
                  const meta = SEVERITY_META[n.severity] || SEVERITY_META.INFO;
                  const Icon = meta.icon;
                  const isRead = (n as Notification & { read?: boolean }).read;
                  return (
                    <div
                      key={n.id}
                      className={`px-4 py-3 border-b border-[var(--border)] last:border-0 hover:bg-white/[0.02] transition-colors ${isRead ? "opacity-55" : ""}`}
                    >
                      <div className="flex items-start gap-2.5">
                        <div className={`shrink-0 mt-0.5 h-6 w-6 rounded ${meta.bg} flex items-center justify-center relative`}>
                          <Icon className={`h-3.5 w-3.5 ${meta.color}`} />
                          {!isRead && (
                            <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_6px_var(--accent)]" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs font-medium truncate">
                              {n.title}
                            </div>
                            <div className="text-[10px] font-mono text-[var(--muted-foreground)] shrink-0">
                              {timeAgo(n.createdAt)}
                            </div>
                          </div>
                          <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)] line-clamp-2">
                            {n.description}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <Link
              href="/dashboard/notifications"
              onClick={() => setOpen(false)}
              className="block px-4 py-2.5 text-center text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--accent)] hover:bg-white/[0.02] border-t border-[var(--border)] transition-colors"
            >
              View all notifications
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
