"use client";

import { useState } from "react";
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
              className="flex items-center gap-2 h-9 px-4 rounded-lg bg-white text-black hover:bg-white/90 text-sm font-medium glow"
            >
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              Add user
            </button>
          )}
        </div>

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
                          <div className="h-8 w-8 rounded-full bg-white text-black text-xs font-bold flex items-center justify-center">
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
            className="h-8 px-4 rounded-lg bg-white text-black hover:bg-white/90 disabled:opacity-50 text-xs font-medium flex items-center gap-1.5 glow"
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
