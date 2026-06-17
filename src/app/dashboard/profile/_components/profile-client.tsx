"use client";

import { useState, useTransition } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  User,
  Shield,
  Mail,
  Calendar,
  Globe,
  KeyRound,
  Lock,
  LogOut,
  CheckCircle2,
  AlertCircle,
  Server,
  Clock,
  Eye,
  EyeOff,
  Activity,
  Sparkles,
} from "lucide-react";

type ProfileUser = {
  id: string;
  email: string;
  name: string | null;
  role: "OWNER" | "ADMIN" | "ANALYST" | "VIEWER";
  isActive: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  createdAt: string;
  assetCount: number;
  activeSessionCount: number;
};

const ROLE_META: Record<ProfileUser["role"], { label: string; color: string; bg: string; description: string }> = {
  OWNER: {
    label: "Owner",
    color: "text-[var(--accent)]",
    bg: "bg-[var(--accent-soft)] border-[var(--accent-border)]",
    description: "Full access, including user management & system settings",
  },
  ADMIN: {
    label: "Admin",
    color: "text-[var(--info)]",
    bg: "bg-[var(--info)]/10 border-[var(--info)]/30",
    description: "Manage assets, alerts, view audit logs",
  },
  ANALYST: {
    label: "Analyst",
    color: "text-[var(--warning)]",
    bg: "bg-[var(--warning)]/10 border-[var(--warning)]/30",
    description: "Investigate alerts, generate reports",
  },
  VIEWER: {
    label: "Viewer",
    color: "text-[var(--muted-foreground)]",
    bg: "bg-white/[0.04] border-[var(--border)]",
    description: "Read-only access to dashboard",
  },
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function ProfileClient({ user }: { user: ProfileUser }) {
  const router = useRouter();
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState(false);
  const [pwdPending, startPwdTransition] = useTransition();
  const [signoutAllPending, setSignoutAllPending] = useState(false);
  const [signoutAllSuccess, setSignoutAllSuccess] = useState(false);

  const roleMeta = ROLE_META[user.role];

  async function handleChangePassword() {
    setPwdError(null);
    setPwdSuccess(false);
    if (newPwd.length < 12) {
      setPwdError("Password must be at least 12 characters");
      return;
    }
    if (newPwd !== confirmPwd) {
      setPwdError("New passwords do not match");
      return;
    }
    if (currentPwd === newPwd) {
      setPwdError("New password must differ from current");
      return;
    }
    startPwdTransition(async () => {
      try {
        const r = await fetch("/api/auth/change-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentPassword: currentPwd, newPassword: newPwd }),
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          setPwdError(d.error || "Failed to change password");
          return;
        }
        setPwdSuccess(true);
        setCurrentPwd("");
        setNewPwd("");
        setConfirmPwd("");
        setTimeout(() => {
          setShowPasswordForm(false);
          setPwdSuccess(false);
        }, 1500);
      } catch {
        setPwdError("Network error");
      }
    });
  }

  async function handleSignOutAll() {
    setSignoutAllPending(true);
    try {
      await fetch("/api/auth/sign-out-all", { method: "POST" });
      setSignoutAllSuccess(true);
      setTimeout(() => router.push("/login"), 1200);
    } catch {
      /* ignore */
    } finally {
      setSignoutAllPending(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="h-4 w-4 text-[var(--accent)]" />
          <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
        </div>
        <p className="text-sm text-[var(--muted-foreground)]">
          Manage your account, security settings, and active sessions
        </p>
      </motion.div>

      {/* Account Card */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
        className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden"
      >
        <div
          className="px-6 py-8 border-b border-[var(--border)] relative overflow-hidden"
          style={{
            backgroundImage:
              "linear-gradient(rgba(16,185,129,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(16,185,129,0.04) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        >
          <div className="flex items-start gap-5">
            <div className="h-20 w-20 rounded-2xl bg-[var(--accent-soft)] border-2 border-[var(--accent-border)] flex items-center justify-center shrink-0">
              <User className="h-10 w-10 text-[var(--accent)]" strokeWidth={1.75} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <h2 className="text-xl font-semibold truncate">
                  {user.name || user.email.split("@")[0]}
                </h2>
                <span
                  className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border ${roleMeta.bg} ${roleMeta.color}`}
                >
                  {roleMeta.label}
                </span>
                {user.isActive ? (
                  <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border bg-[var(--accent)]/10 text-[var(--accent)] border-[var(--accent)]/30 flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
                    Active
                  </span>
                ) : (
                  <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border bg-[var(--danger)]/10 text-[var(--danger)] border-[var(--danger)]/30">
                    Disabled
                  </span>
                )}
              </div>
              <p className="text-sm text-[var(--muted-foreground)] mb-3">{roleMeta.description}</p>
              <div className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
                <Mail className="h-3.5 w-3.5" />
                <span className="font-mono">{user.email}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[var(--border)]">
          <div className="px-6 py-4">
            <div className="flex items-center gap-1.5 mb-1">
              <Calendar className="h-3 w-3 text-[var(--muted-foreground)]" />
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--muted-foreground)]">
                Member since
              </span>
            </div>
            <div className="text-sm font-medium">{formatDate(user.createdAt)}</div>
          </div>
          <div className="px-6 py-4">
            <div className="flex items-center gap-1.5 mb-1">
              <Server className="h-3 w-3 text-[var(--muted-foreground)]" />
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--muted-foreground)]">
                Assets owned
              </span>
            </div>
            <div className="text-sm font-medium">
              {user.assetCount} {user.assetCount === 1 ? "asset" : "assets"}
            </div>
          </div>
          <div className="px-6 py-4">
            <div className="flex items-center gap-1.5 mb-1">
              <Activity className="h-3 w-3 text-[var(--muted-foreground)]" />
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--muted-foreground)]">
                Active sessions
              </span>
            </div>
            <div className="text-sm font-medium">{user.activeSessionCount}</div>
          </div>
        </div>
      </motion.div>

      {/* Security + Activity grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Security Card */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden"
        >
          <div className="px-5 py-3.5 border-b border-[var(--border)] flex items-center gap-2">
            <Shield className="h-4 w-4 text-[var(--accent)]" />
            <h3 className="text-sm font-semibold">Security</h3>
          </div>
          <div className="p-5 space-y-4">
            {/* MFA Status */}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">Two-Factor Authentication</div>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                  TOTP via authenticator app
                </p>
              </div>
              {user.mfaEnabled ? (
                <span className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/30">
                  <CheckCircle2 className="h-3 w-3" />
                  Enabled
                </span>
              ) : (
                <span className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider bg-[var(--warning)]/10 text-[var(--warning)] border border-[var(--warning)]/30">
                  <AlertCircle className="h-3 w-3" />
                  Disabled
                </span>
              )}
            </div>

            {/* Password */}
            <div className="border-t border-[var(--border)] pt-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">Password</div>
                  <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                    Last changed on account creation
                  </p>
                </div>
                <button
                  onClick={() => setShowPasswordForm((v) => !v)}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] hover:border-[var(--accent-border)] text-xs font-medium transition-colors"
                >
                  <KeyRound className="h-3 w-3" />
                  {showPasswordForm ? "Cancel" : "Change"}
                </button>
              </div>

              {showPasswordForm && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-2.5 overflow-hidden"
                >
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                    <input
                      type={showCurrent ? "text" : "password"}
                      placeholder="Current password"
                      value={currentPwd}
                      onChange={(e) => setCurrentPwd(e.target.value)}
                      className="w-full pl-9 pr-10 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--background)] focus:border-[var(--accent)] outline-none"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrent((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] hover:text-[var(--accent)]"
                    >
                      {showCurrent ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                    <input
                      type={showNew ? "text" : "password"}
                      placeholder="New password (min 12 chars)"
                      value={newPwd}
                      onChange={(e) => setNewPwd(e.target.value)}
                      className="w-full pl-9 pr-10 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--background)] focus:border-[var(--accent)] outline-none"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNew((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] hover:text-[var(--accent)]"
                    >
                      {showNew ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <input
                    type={showNew ? "text" : "password"}
                    placeholder="Confirm new password"
                    value={confirmPwd}
                    onChange={(e) => setConfirmPwd(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--background)] focus:border-[var(--accent)] outline-none"
                    autoComplete="new-password"
                  />

                  {pwdError && (
                    <div className="flex items-center gap-1.5 text-xs text-[var(--danger)]">
                      <AlertCircle className="h-3 w-3" />
                      {pwdError}
                    </div>
                  )}
                  {pwdSuccess && (
                    <div className="flex items-center gap-1.5 text-xs text-[var(--accent)]">
                      <CheckCircle2 className="h-3 w-3" />
                      Password updated successfully
                    </div>
                  )}

                  <button
                    onClick={handleChangePassword}
                    disabled={pwdPending || !currentPwd || !newPwd || !confirmPwd}
                    className="w-full py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent)]/90 disabled:opacity-50 disabled:cursor-not-allowed text-[var(--accent-foreground)] text-sm font-medium transition-colors"
                  >
                    {pwdPending ? "Updating…" : "Update password"}
                  </button>
                </motion.div>
              )}
            </div>
          </div>
        </motion.div>

        {/* Activity Card */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.15 }}
          className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden"
        >
          <div className="px-5 py-3.5 border-b border-[var(--border)] flex items-center gap-2">
            <Clock className="h-4 w-4 text-[var(--accent)]" />
            <h3 className="text-sm font-semibold">Recent activity</h3>
          </div>
          <div className="p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-lg bg-[var(--accent-soft)] border border-[var(--accent-border)] flex items-center justify-center shrink-0">
                <Globe className="h-3.5 w-3.5 text-[var(--accent)]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">Last login</div>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5 font-mono break-all">
                  {user.lastLoginIp || "—"}
                </p>
                <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">
                  {formatDate(user.lastLoginAt)} • {timeAgo(user.lastLoginAt)}
                </p>
              </div>
            </div>

            <div className="border-t border-[var(--border)] pt-4">
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-lg bg-[var(--accent-soft)] border border-[var(--accent-border)] flex items-center justify-center shrink-0">
                  <Calendar className="h-3.5 w-3.5 text-[var(--accent)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">Account created</div>
                  <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                    {formatDate(user.createdAt)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Danger Zone */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.2 }}
        className="rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/[0.02] overflow-hidden"
      >
        <div className="px-5 py-3.5 border-b border-[var(--danger)]/30 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-[var(--danger)]" />
          <h3 className="text-sm font-semibold text-[var(--danger)]">Danger zone</h3>
        </div>
        <div className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">Sign out from all devices</div>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Revoke all active sessions across every device. You'll need to log in again.
            </p>
          </div>
          <button
            onClick={handleSignOutAll}
            disabled={signoutAllPending || signoutAllSuccess}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 hover:bg-[var(--danger)]/20 text-[var(--danger)] text-xs font-medium transition-colors disabled:opacity-50"
          >
            {signoutAllSuccess ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" />
                Signed out — redirecting…
              </>
            ) : signoutAllPending ? (
              <>
                <LogOut className="h-3.5 w-3.5 animate-pulse" />
                Signing out…
              </>
            ) : (
              <>
                <LogOut className="h-3.5 w-3.5" />
                Sign out all
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
