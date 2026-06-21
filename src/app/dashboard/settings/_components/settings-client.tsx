"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Users,
  Shield,
  Bell,
  Plus,
  ToggleLeft,
  ToggleRight,
  Loader2,
  AlertCircle,
  Power,
  PowerOff,
  X,
  Globe,
  FlaskConical,
  Sparkles,
  Trash2,
  Database,
  Activity,
  AlertTriangle,
  RefreshCw,
  Play,
} from "lucide-react";
import { toast } from "sonner";

type Role = "OWNER" | "ADMIN" | "VIEWER";

type User = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  isActive: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  assetCount: number;
};

type Settings = {
  registration_enabled: boolean;
  alert_min_severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  webhook_enabled: boolean;
  webhook_url: string;
  retention_low_days: number;
  retention_high_days: number;
};

export function SettingsClient({
  currentUserId,
  currentUser,
  users,
  settings,
}: {
  currentUserId: string;
  currentUser: { id: string; role: Role };
  users: User[];
  settings: Settings;
}) {
  const router = useRouter();
  const [userList, setUserList] = useState(users);
  const [sysSettings, setSysSettings] = useState(settings);
  const [savingSettings, setSavingSettings] = useState(false);
  const [showAddUser, setShowAddUser] = useState(false);

  const isOwner = currentUser.role === "OWNER";
  const isAdmin = currentUser.role === "OWNER" || currentUser.role === "ADMIN";

  async function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSysSettings({ ...sysSettings, [key]: value });
    setSavingSettings(true);
    try {
      const r = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        toast.error(d.error || "Gagal save setting");
        setSysSettings(sysSettings);
        return;
      }
      toast.success("Setting disimpan");
    } catch {
      toast.error("Network error");
      setSysSettings(sysSettings);
    } finally {
      setSavingSettings(false);
    }
  }

  async function toggleUserActive(user: User) {
    const newActive = !user.isActive;
    setUserList(userList.map((u) => (u.id === user.id ? { ...u, isActive: newActive } : u)));
    const r = await fetch(`/api/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: newActive }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      toast.error(d.error || "Gagal update user");
      setUserList(userList.map((u) => (u.id === user.id ? { ...u, isActive: user.isActive } : u)));
      return;
    }
    toast.success(newActive ? `${user.email} diaktifkan` : `${user.email} dinonaktifkan`);
    router.refresh();
  }

  async function changeUserRole(user: User, newRole: Role) {
    if (!isOwner) {
      toast.error("Hanya OWNER yang bisa ubah role");
      return;
    }
    setUserList(userList.map((u) => (u.id === user.id ? { ...u, role: newRole } : u)));
    const r = await fetch(`/api/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      toast.error(d.error || "Gagal update role");
      setUserList(userList.map((u) => (u.id === user.id ? { ...u, role: user.role } : u)));
      return;
    }
    toast.success(`Role ${user.email} → ${newRole}`);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Manage users dan system configuration. Reports &amp; Analysis ada di menu sidebar.
        </p>
      </div>

      {/* User Management Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Users className="h-4 w-4" />
              User Management
            </h2>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              {userList.length} user{userList.length !== 1 ? "s" : ""} registered
            </p>
          </div>
          {isOwner && (
            <button
              onClick={() => setShowAddUser(true)}
              className="flex items-center gap-2 h-9 px-4 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 text-sm font-medium"
            >
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              Add user
            </button>
          )}
        </div>

        {/* Event Log Retention */}
        {(isOwner || isAdmin) && (
          <RetentionSection
            lowDays={sysSettings.retention_low_days}
            highDays={sysSettings.retention_high_days}
            disabled={savingSettings}
            onSave={async (low, high) => {
              setSavingSettings(true);
              try {
                const r = await fetch("/api/admin/cleanup", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ lowDays: low, highDays: high }),
                });
                if (!r.ok) {
                  const d = await r.json().catch(() => ({}));
                  toast.error(d.message || d.error || "Gagal save retention");
                  return;
                }
                setSysSettings({
                  ...sysSettings,
                  retention_low_days: low,
                  retention_high_days: high,
                });
                toast.success("Retention policy disimpan");
              } catch {
                toast.error("Network error");
              } finally {
                setSavingSettings(false);
              }
            }}
          />
        )}

        {showAddUser && (
          <AddUserForm
            onClose={() => setShowAddUser(false)}
            onAdded={(u) => {
              setUserList([...userList, u]);
              setShowAddUser(false);
            }}
          />
        )}

        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-white/[0.02]">
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    User
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    Role
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    Assets
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] hidden sm:table-cell">
                    Last login
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    Status
                  </th>
                  <th className="text-right px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {userList.map((u) => {
                  const isCurrent = u.id === currentUserId;
                  return (
                    <tr
                      key={u.id}
                      className="border-b border-[var(--border)] last:border-0 hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 text-xs font-bold flex items-center justify-center">
                            {u.email.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate flex items-center gap-2">
                              {u.email}
                              {isCurrent && (
                                <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/[0.06] border border-[var(--border)]">
                                  You
                                </span>
                              )}
                              {u.mfaEnabled && <Shield className="h-3 w-3 text-[var(--success)]" />}
                            </div>
                            {u.name && (
                              <div className="text-[10px] text-[var(--muted-foreground)]">{u.name}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {isOwner && !isCurrent ? (
                          <select
                            value={u.role}
                            onChange={(e) => changeUserRole(u, e.target.value as Role)}
                            className="bg-[var(--background)] border border-[var(--border)] rounded px-2 py-1 text-xs font-mono"
                          >
                            <option value="OWNER">OWNER</option>
                            <option value="ADMIN">ADMIN</option>
                            <option value="VIEWER">VIEWER</option>
                          </select>
                        ) : (
                          <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/[0.06] border border-[var(--border)]">
                            {u.role}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono tabular-nums text-[var(--muted-foreground)]">
                        {u.assetCount}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--muted-foreground)] hidden sm:table-cell font-mono">
                        {u.lastLoginAt
                          ? new Date(u.lastLoginAt).toLocaleString("id-ID", {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "never"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider ${
                            u.isActive ? "text-[var(--success)]" : "text-[var(--muted-foreground)]"
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              u.isActive ? "bg-[var(--success)]" : "bg-[var(--muted)]"
                            }`}
                          />
                          {u.isActive ? "Active" : "Disabled"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!isCurrent && (
                          <button
                            onClick={() => toggleUserActive(u)}
                            className={`h-7 px-2.5 rounded text-[10px] font-mono uppercase tracking-wider transition-colors ${
                              u.isActive
                                ? "text-[var(--muted-foreground)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10"
                                : "text-[var(--success)] hover:bg-[var(--success)]/10"
                            }`}
                            title={u.isActive ? "Disable user" : "Enable user"}
                          >
                            {u.isActive ? (
                              <PowerOff className="h-3.5 w-3.5 inline" />
                            ) : (
                              <Power className="h-3.5 w-3.5 inline" />
                            )}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* System Configuration */}
      <div className="space-y-4">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Shield className="h-4 w-4" />
            System Configuration
          </h2>
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
            Global settings untuk registration, alerts, dan notifikasi
          </p>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] divide-y divide-[var(--border)]">
          {/* Registration toggle */}
          <div className="p-5 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="h-9 w-9 rounded-lg bg-white/[0.04] border border-[var(--border)] flex items-center justify-center shrink-0">
                <Users className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium">Open Registration</div>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                  Allow new users to register via the /register page. When disabled, only admins can add users manually.
                </p>
              </div>
            </div>
            <button
              onClick={() => updateSetting("registration_enabled", !sysSettings.registration_enabled)}
              disabled={savingSettings}
              className="shrink-0"
            >
              {sysSettings.registration_enabled ? (
                <ToggleRight className="h-7 w-7 text-[var(--success)]" />
              ) : (
                <ToggleLeft className="h-7 w-7 text-[var(--muted-foreground)]" />
              )}
            </button>
          </div>

          {/* Alert min severity */}
          <div className="p-5 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="h-9 w-9 rounded-lg bg-white/[0.04] border border-[var(--border)] flex items-center justify-center shrink-0">
                <Bell className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium">Minimum Alert Severity</div>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                  Only create alerts at or above this severity level.
                </p>
              </div>
            </div>
            <select
              value={sysSettings.alert_min_severity}
              onChange={(e) =>
                updateSetting("alert_min_severity", e.target.value as Settings["alert_min_severity"])
              }
              disabled={savingSettings}
              className="bg-[var(--background)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs font-mono"
            >
              <option value="LOW">LOW</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="HIGH">HIGH</option>
              <option value="CRITICAL">CRITICAL</option>
            </select>
          </div>

          {/* Webhook */}
          <div className="p-5 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <div className="h-9 w-9 rounded-lg bg-white/[0.04] border border-[var(--border)] flex items-center justify-center shrink-0">
                  <Globe className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium">Webhook Notifications</div>
                  <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                    POST alert events ke external URL (Slack, Discord, PagerDuty, custom)
                  </p>
                </div>
              </div>
              <button
                onClick={() => updateSetting("webhook_enabled", !sysSettings.webhook_enabled)}
                disabled={savingSettings}
              >
                {sysSettings.webhook_enabled ? (
                  <ToggleRight className="h-7 w-7 text-[var(--success)]" />
                ) : (
                  <ToggleLeft className="h-7 w-7 text-[var(--muted-foreground)]" />
                )}
              </button>
            </div>
            {sysSettings.webhook_enabled && (
              <div>
                <label className="block text-[10px] font-medium text-[var(--muted-foreground)] mb-1">
                  Webhook URL
                </label>
                <input
                  type="url"
                  value={sysSettings.webhook_url}
                  onChange={(e) => updateSetting("webhook_url", e.target.value)}
                  placeholder="https://hooks.slack.com/services/..."
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm font-mono focus:border-[var(--foreground)] focus:outline-none"
                />
                <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">
                  Payload: <code className="text-[var(--foreground)]">{"{ alert, asset, user }"}</code> (JSON, POST)
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-white/[0.02] p-4 flex items-start gap-2 text-xs text-[var(--muted-foreground)]">
          <Shield className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            Settings changes di-audit log. Webhook secret (jika ada) akan di-hash sebelum disimpan.
          </span>
        </div>
      </div>

      {/* Poller Status — only visible to OWNER/ADMIN */}
      {(isOwner || isAdmin) && <PollerStatusSection />}

      {/* Mock Data / Test Tools — only visible to OWNER */}
      {isOwner && <MockDataSection />}

    </div>
  );
}

/* ------------------------------------------------------------------
 * Retention Section — edit event log retention policy (inline)
 * ------------------------------------------------------------------ */
function RetentionSection({
  lowDays,
  highDays,
  disabled,
  onSave,
}: {
  lowDays: number;
  highDays: number;
  disabled: boolean;
  onSave: (low: number, high: number) => Promise<void>;
}) {
  const [low, setLow] = useState(lowDays);
  const [high, setHigh] = useState(highDays);
  const [saving, setSaving] = useState(false);

  const dirty = low !== lowDays || high !== highDays;
  const valid =
    Number.isInteger(low) &&
    Number.isInteger(high) &&
    low >= 1 &&
    low <= 365 &&
    high >= 1 &&
    high <= 365 &&
    low <= high;

  const handle = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await onSave(low, high);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] mt-4">
      <div className="p-5 border-b border-[var(--border)]">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-white/[0.04] border border-[var(--border)] flex items-center justify-center shrink-0">
            <Database className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Event Log Retention</h2>
              <Link
                href="/dashboard/admin/cleanup"
                className="text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] underline-offset-2 hover:underline"
                title="Open full cleanup admin"
              >
                Full admin →
              </Link>
            </div>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Berapa lama event log disimpan sebelum auto-dihapus oleh systemd
              timer (nightly 03:17 WIB).
            </p>
          </div>
        </div>
      </div>

      <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-[var(--foreground)] mb-1.5">
            Low Retention
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={365}
              value={low}
              onChange={(e) => setLow(parseInt(e.target.value) || 1)}
              disabled={disabled || saving}
              className="w-20 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm font-mono focus:border-[var(--foreground)] focus:outline-none disabled:opacity-50"
            />
            <span className="text-xs text-[var(--muted-foreground)]">hari</span>
          </div>
          <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
            Untuk: <span className="font-mono">syslog</span>,{" "}
            <span className="font-mono">fim</span>,{" "}
            <span className="font-mono">auditd</span>
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-[var(--foreground)] mb-1.5">
            High Retention
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={365}
              value={high}
              onChange={(e) => setHigh(parseInt(e.target.value) || 1)}
              disabled={disabled || saving}
              className="w-20 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm font-mono focus:border-[var(--foreground)] focus:outline-none disabled:opacity-50"
            />
            <span className="text-xs text-[var(--muted-foreground)]">hari</span>
          </div>
          <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
            Untuk: <span className="font-mono">server_auth</span>,{" "}
            <span className="font-mono">apps</span>,{" "}
            <span className="font-mono">database</span>
          </p>
        </div>
      </div>

      <div className="px-5 pb-5 flex items-center gap-3">
        <button
          onClick={handle}
          disabled={!dirty || !valid || saving || disabled}
          className="px-3 py-1.5 rounded-lg bg-[var(--foreground)] text-[var(--background)] text-xs font-medium hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-opacity flex items-center gap-2"
        >
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          Save retention
        </button>
        {dirty && valid && (
          <span className="text-[11px] text-amber-400">Unsaved</span>
        )}
        {!valid && (
          <span className="text-[11px] text-amber-400 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            Low harus ≤ high (1-365 hari)
          </span>
        )}
        <Link
          href="/dashboard/admin/cleanup"
          className="ml-auto text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          View run history →
        </Link>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
 * Poller Status Section — view poll status of all assets
 * ------------------------------------------------------------------ */
type PollerAsset = {
  id: string;
  hostname: string;
  category: "SSH" | "DATABASE";
  environment: string;
  pollerStatus: "IDLE" | "POLLING" | "OK" | "ERROR";
  pollerError: string | null;
  lastPolledAt: string | null;
  pollCount: number;
  lastSeenAt: string | null;
  status: "PENDING" | "ONLINE" | "OFFLINE" | "ERROR";
};

function PollerStatusSection() {
  const [assets, setAssets] = useState<PollerAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);

  async function refresh() {
    setLoading(true);
    try {
      const r = await fetch("/api/poller/run", { credentials: "include" });
      if (r.ok) {
        const d = await r.json();
        setAssets(d.assets ?? []);
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }

  async function runNow() {
    setTriggering(true);
    try {
      const r = await fetch("/api/poller/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        credentials: "include",
      });
      const d = await r.json();
      if (!r.ok) {
        toast.error(d.error || "Poller run failed");
        return;
      }
      setLastResult(d);
      toast.success(
        `Poll: ${d.success}✓ ${d.failed}✗ — ${d.eventsInserted}/${d.eventsCollected} events inserted (${d.durationMs}ms)`
      );
      await refresh();
    } catch (e) {
      toast.error("Network error — cek console");
    } finally {
      setTriggering(false);
    }
  }

  useEffect(() => {
    refresh();
    const i = setInterval(refresh, 15_000); // auto-refresh every 15s
    return () => clearInterval(i);
  }, []);

  const okCount = assets.filter((a) => a.pollerStatus === "OK").length;
  const errCount = assets.filter((a) => a.pollerStatus === "ERROR").length;
  const idleCount = assets.filter((a) => a.pollerStatus === "IDLE" || !a.pollerStatus).length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Activity className="h-4 w-4" />
          Poller Status (Central SSH / DB Monitor)
        </h2>
        <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
          Real-time status dari polling engine yang menarik event dari server lo
          (SSH auth.log, DB session queries) ke OpenShield. Auto-poll setiap
          30 detik.
        </p>
      </div>

      <div className="rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div className="flex items-center gap-4 sm:gap-6 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="text-[var(--muted-foreground)]">OK:</span>
              <span className="font-mono font-semibold">{okCount}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-red-500" />
              <span className="text-[var(--muted-foreground)]">Error:</span>
              <span className="font-mono font-semibold">{errCount}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-zinc-500" />
              <span className="text-[var(--muted-foreground)]">Idle:</span>
              <span className="font-mono font-semibold">{idleCount}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[var(--muted-foreground)]">Total:</span>
              <span className="font-mono font-semibold">{assets.length}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={runNow}
              disabled={triggering}
              className="flex items-center gap-1.5 h-8 px-3 rounded-md bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 text-xs font-medium"
            >
              {triggering ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Run Poll Now
            </button>
            <button
              onClick={refresh}
              disabled={loading}
              className="h-8 px-2.5 rounded-md text-[var(--muted-foreground)] hover:bg-white/[0.04] flex items-center gap-1 text-xs"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        {lastResult && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-xs">
            <div className="font-medium text-emerald-400 mb-1">
              Last poll result ({new Date(lastResult.finishedAt).toLocaleString("id-ID")})
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[var(--muted-foreground)]">
              <div>
                <div>Total assets</div>
                <div className="font-mono font-semibold text-[var(--foreground)]">
                  {lastResult.totalAssets}
                </div>
              </div>
              <div>
                <div>Events collected</div>
                <div className="font-mono font-semibold text-emerald-400">
                  {lastResult.eventsCollected}
                </div>
              </div>
              <div>
                <div>Inserted</div>
                <div className="font-mono font-semibold text-emerald-400">
                  {lastResult.eventsInserted}
                </div>
              </div>
              <div>
                <div>Duration</div>
                <div className="font-mono font-semibold text-[var(--foreground)]">
                  {lastResult.durationMs}ms
                </div>
              </div>
            </div>
            {lastResult.errors?.length > 0 && (
              <div className="mt-2 text-red-400">
                {lastResult.errors.length} error(s): {lastResult.errors[0]?.error?.slice(0, 100)}
              </div>
            )}
          </div>
        )}

        <div className="space-y-1.5 max-h-96 overflow-y-auto">
          {assets.length === 0 && (
            <div className="text-xs text-[var(--muted-foreground)] py-4 text-center">
              Belum ada assets SSH/DATABASE. Tambah server di menu Assets dulu.
            </div>
          )}
          {assets.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02] border border-[var(--border)] hover:bg-white/[0.04] transition"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`h-2 w-2 rounded-full shrink-0 ${
                    a.pollerStatus === "OK"
                      ? "bg-emerald-500"
                      : a.pollerStatus === "ERROR"
                      ? "bg-red-500"
                      : a.pollerStatus === "POLLING"
                      ? "bg-blue-500 animate-pulse"
                      : "bg-zinc-500"
                  }`}
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm">
                    <code className="font-mono truncate">{a.hostname}</code>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.05] text-[var(--muted-foreground)]">
                      {a.category}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.05] text-[var(--muted-foreground)]">
                      {a.environment}
                    </span>
                  </div>
                  {a.pollerError && (
                    <div className="text-[10px] text-red-400 mt-0.5 truncate max-w-md">
                      {a.pollerError}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-4 text-[10px] text-[var(--muted-foreground)] shrink-0">
                <div className="font-mono">
                  {a.pollCount} polls
                </div>
                <div className="font-mono w-32 text-right">
                  {a.lastPolledAt
                    ? new Date(a.lastPolledAt).toLocaleString("id-ID", {
                        dateStyle: "short",
                        timeStyle: "medium",
                      })
                    : "never"}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
 * Mock Data Section — generate / clear test data
 * ------------------------------------------------------------------ */
type MockBatch = { batchId: string; assetCount: number; createdAt: string };

function MockDataSection() {
  const router = useRouter();
  const [loading, setLoading] = useState<"generate" | "clear" | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [batches, setBatches] = useState<MockBatch[]>([]);
  const [totalMock, setTotalMock] = useState(0);
  const [scale, setScale] = useState<"small" | "medium" | "large">("medium");

  async function refresh() {
    try {
      const r = await fetch("/api/mock/clear");
      if (r.ok) {
        const d = await r.json();
        setBatches(d.batches ?? []);
        setTotalMock(d.totalMockAssets ?? 0);
      }
    } catch {
      // silent
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function generate() {
    setLoading("generate");
    console.log("[MOCK] Generate clicked, scale:", scale);
    try {
      const r = await fetch("/api/mock/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scale }),
        credentials: "include",
      });
      const d = await r.json();
      console.log("[MOCK] Generate response:", r.status, d);
      if (!r.ok) {
        toast.error(d.error || `Gagal generate (${r.status})`);
        return;
      }
      toast.success(
        `Mock data generated: ${d.created.assets} assets, ${d.created.serverEvents} SSH events, ${d.created.dbEvents} DB events, ${d.created.alerts} alerts`
      );
      await refresh();
      router.refresh();
    } catch (e) {
      console.error("[MOCK] Generate network error:", e);
      toast.error("Network error — cek console browser");
    } finally {
      setLoading(null);
    }
  }

  async function clearAll() {
    setLoading("clear");
    console.log("[MOCK] Clear clicked, current totalMock:", totalMock);
    try {
      const r = await fetch("/api/mock/clear", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        credentials: "include",
      });
      const d = await r.json();
      console.log("[MOCK] Clear response:", r.status, d);
      if (!r.ok) {
        toast.error(d.error || `Gagal clear (${r.status})`);
        return;
      }
      if (d.deleted.assets === 0 && d.deleted.alerts === 0 && d.deleted.serverEvents === 0) {
        toast("Tidak ada mock data untuk dihapus", { icon: "ℹ️" });
      } else {
        toast.success(
          `Cleared ${d.deleted.assets} assets, ${d.deleted.serverEvents} SSH events, ${d.deleted.dbEvents} DB events, ${d.deleted.alerts} alerts`
        );
      }
      setConfirmClear(false);
      await refresh();
      router.refresh();
    } catch (e) {
      console.error("[MOCK] Clear network error:", e);
      toast.error("Network error — cek console browser");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <FlaskConical className="h-4 w-4" />
          Mock Data / Test Tools
        </h2>
        <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
          Generate sample assets & events untuk testing dashboard, alerts, dan reports.
          Mock assets diprefix <code className="text-emerald-400 font-mono">mock-</code>
          dan bisa dihapus bersih kapan aja.
        </p>
      </div>

      {/* Empty state banner — shown when no mock data exists */}
      {totalMock === 0 && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 flex items-start gap-2 text-xs text-[var(--muted-foreground)]">
          <Database className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
          <span>
            <strong className="text-emerald-300">No mock data saat ini.</strong>{" "}
            Klik <strong>Generate</strong> di bawah untuk populate data testing.
            Tombol Clear akan enable otomatis setelah ada data.
          </span>
        </div>
      )}

      <div className="rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] p-5">
        {/* Status row */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex items-center gap-4 sm:gap-6">
            <div className="flex items-center gap-2">
              <Database className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
              <span className="text-xs text-[var(--muted-foreground)]">Mock assets:</span>
              <span className="text-sm font-mono font-semibold tabular-nums">
                {totalMock}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Activity className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
              <span className="text-xs text-[var(--muted-foreground)]">Batches:</span>
              <span className="text-sm font-mono font-semibold tabular-nums">
                {batches.length}
              </span>
            </div>
          </div>
          <button
            onClick={refresh}
            disabled={loading !== null}
            className="h-7 px-2.5 rounded-md text-[10px] text-[var(--muted-foreground)] hover:bg-white/[0.04] flex items-center gap-1"
            title="Refresh status"
          >
            <RefreshCw className={`h-3 w-3 ${loading === null ? "" : "animate-spin"}`} />
            Refresh
          </button>
        </div>

        {/* Last batch info */}
        {batches.length > 0 && (
          <div className="mb-4 p-3 rounded-lg bg-white/[0.02] border border-[var(--border)]">
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] mb-1.5">
              Recent batches
            </div>
            <div className="space-y-1">
              {batches.slice(0, 3).map((b) => (
                <div key={b.batchId} className="flex items-center justify-between text-[11px]">
                  <code className="font-mono text-emerald-400">mock-{b.batchId}</code>
                  <span className="text-[var(--muted-foreground)] font-mono">
                    {b.assetCount} assets · {new Date(b.createdAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Scale selector */}
        <div className="mb-4">
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] mb-1.5">
            Data volume
          </div>
          <div className="grid grid-cols-3 gap-1.5 p-1 rounded-lg bg-white/[0.03] border border-[var(--border)] w-fit">
            {(["small", "medium", "large"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScale(s)}
                disabled={loading !== null}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all border ${
                  scale === s
                    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-white/[0.04] border-transparent"
                }`}
              >
                {s === "small" && "Small"}
                {s === "medium" && "Medium"}
                {s === "large" && "Large"}
              </button>
            ))}
          </div>
          <div className="text-[10px] text-[var(--muted-foreground)] mt-1.5">
            {scale === "small" && "12 assets · ~300 SSH events · ~240 DB events · 3 alerts"}
            {scale === "medium" && "12 assets · ~960 SSH events · ~600 DB events · 6 alerts"}
            {scale === "large" && "12 assets · ~2,400 SSH events · ~1,440 DB events · 10 alerts"}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={generate}
            disabled={loading !== null}
            className="flex items-center gap-2 h-10 px-5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
          >
            {loading === "generate" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" strokeWidth={2.5} />
            )}
            Generate Mock Data
          </button>

          <button
            onClick={() => setConfirmClear(true)}
            disabled={loading !== null || totalMock === 0}
            className="flex items-center gap-2 h-10 px-5 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 text-[var(--danger)] hover:bg-[var(--danger)]/20 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
          >
            {loading === "clear" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" strokeWidth={2.5} />
            )}
            Clear Mock Data
          </button>
        </div>

        {/* Info banner */}
        <div className="mt-5 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/10 p-3 flex items-start gap-2 text-xs text-[var(--muted-foreground)]">
          <AlertTriangle className="h-3.5 w-3.5 text-[var(--warning)] shrink-0 mt-0.5" />
          <span>
            Mock data disimpan di account lo sendiri dan di-tag dengan prefix <code className="font-mono text-[var(--warning)]">mock-</code>.
            Generate cuma untuk testing — tidak mengganggu data production.
          </span>
        </div>
      </div>

      {/* Confirmation modal */}
      {confirmClear && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => !loading && setConfirmClear(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-[var(--danger)]/40 bg-[var(--background)] shadow-2xl"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-[var(--danger)]/15 border border-[var(--danger)]/40 flex items-center justify-center">
                  <Trash2 className="h-4 w-4 text-[var(--danger)]" strokeWidth={2} />
                </div>
                <h3 className="text-sm font-semibold">Clear all mock data?</h3>
              </div>
              <button
                onClick={() => setConfirmClear(false)}
                className="h-7 w-7 rounded hover:bg-white/[0.05] flex items-center justify-center"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5">
              <p className="text-sm text-[var(--muted-foreground)] mb-3">
                Yakin mau hapus semua mock data? Tindakan ini <strong>tidak bisa dibatalkan</strong>.
              </p>
              <div className="rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/30 p-3 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[var(--muted-foreground)]">Mock assets to delete:</span>
                  <span className="font-mono font-semibold text-[var(--danger)]">{totalMock}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--muted-foreground)]">Batches affected:</span>
                  <span className="font-mono font-semibold text-[var(--danger)]">{batches.length}</span>
                </div>
              </div>
              <p className="text-xs text-[var(--muted-foreground)] mt-3">
                Cascade delete bakal bersihin SSH events, DB events, dan alerts terkait.
                Data production lo <strong>tidak akan tersentuh</strong>.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border)]">
              <button
                onClick={() => setConfirmClear(false)}
                disabled={loading !== null}
                className="h-9 px-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm font-medium hover:bg-white/[0.04]"
              >
                Cancel
              </button>
              <button
                onClick={clearAll}
                disabled={loading !== null}
                className="h-9 px-4 rounded-lg bg-[var(--danger)] text-white hover:bg-[var(--danger)]/90 disabled:opacity-50 text-sm font-medium flex items-center gap-2"
              >
                {loading === "clear" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2.5} />
                )}
                Yes, delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AddUserForm({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (u: User) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("VIEWER");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name: name || undefined, role, password }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error || "Gagal create user");
        return;
      }
      const { user } = await r.json();
      toast.success(`User ${user.email} ditambahkan`);
      onAdded({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: true,
        mfaEnabled: false,
        lastLoginAt: null,
        createdAt: user.createdAt,
        assetCount: 0,
      });
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold">Add new user</h3>
        <button
          onClick={onClose}
          className="h-7 w-7 rounded hover:bg-white/[0.05] flex items-center justify-center"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-medium text-[var(--muted-foreground)] mb-1">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm font-mono focus:border-[var(--foreground)] focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-[10px] font-medium text-[var(--muted-foreground)] mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm focus:border-[var(--foreground)] focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-[10px] font-medium text-[var(--muted-foreground)] mb-1">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm font-mono focus:border-[var(--foreground)] focus:outline-none"
          >
            <option value="VIEWER">VIEWER (read-only)</option>
            <option value="ADMIN">ADMIN (manage assets)</option>
            <option value="OWNER">OWNER (full access)</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-medium text-[var(--muted-foreground)] mb-1">Initial password</label>
          <input
            type="text"
            required
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm font-mono focus:border-[var(--foreground)] focus:outline-none"
            placeholder="Min 12 chars"
          />
        </div>
        {error && (
          <div className="md:col-span-2 flex items-start gap-2 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-2.5 text-xs text-[var(--danger)]">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        <div className="md:col-span-2 flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-3 rounded-lg border border-[var(--border)] hover:bg-white/[0.04] text-xs"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="h-8 px-4 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 text-xs font-medium flex items-center gap-1.5"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            )}
            Create user
          </button>
        </div>
      </form>
    </div>
  );
}
