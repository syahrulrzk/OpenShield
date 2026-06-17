"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Loader2,
  X,
  Server,
  Lock,
  Key,
  Database,
  Terminal,
  AppWindow,
  Sparkles,
  ArrowRight,
  Globe,
  Rocket,
  FlaskConical,
  Code2,
  Shield,
} from "lucide-react";
import { toast } from "sonner";

type DbType = "NONE" | "POSTGRES" | "MYSQL" | "SQLSERVER";
type AssetCategory = "SSH" | "DATABASE" | "APP";
type Environment = "PROD" | "STAGING" | "UAT" | "DEV" | "DR";

const DB_DEFAULTS: Record<Exclude<DbType, "NONE">, number> = {
  POSTGRES: 5432,
  MYSQL: 3306,
  SQLSERVER: 1433,
};

const CATEGORIES: {
  id: AssetCategory;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  available: boolean;
  badge?: string;
  color: string;
}[] = [
  {
    id: "SSH",
    label: "Akses SSH",
    desc: "Monitor login SSH (auth.log / secure)",
    icon: Terminal,
    available: true,
    color: "emerald",
  },
  {
    id: "DATABASE",
    label: "Akses Database",
    desc: "Postgres, MySQL, SQL Server login events",
    icon: Database,
    available: true,
    color: "blue",
  },
  {
    id: "APP",
    label: "Akses Apps",
    desc: "Application-layer access monitoring",
    icon: AppWindow,
    available: false,
    badge: "Soon",
    color: "violet",
  },
];

const ENVIRONMENTS: {
  id: Environment;
  label: string;
  desc: string;
  color: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
}[] = [
  {
    id: "PROD",
    label: "Production",
    desc: "Live customer-facing",
    color: "#ef4444",
    bgClass: "bg-red-500/10",
    textClass: "text-red-400",
    borderClass: "border-red-500/30",
  },
  {
    id: "STAGING",
    label: "Staging",
    desc: "Pre-production mirror",
    color: "#f97316",
    bgClass: "bg-orange-500/10",
    textClass: "text-orange-400",
    borderClass: "border-orange-500/30",
  },
  {
    id: "UAT",
    label: "UAT",
    desc: "User Acceptance Testing",
    color: "#3b82f6",
    bgClass: "bg-blue-500/10",
    textClass: "text-blue-400",
    borderClass: "border-blue-500/30",
  },
  {
    id: "DEV",
    label: "Development",
    desc: "Dev / sandbox environment",
    color: "#10b981",
    bgClass: "bg-emerald-500/10",
    textClass: "text-emerald-400",
    borderClass: "border-emerald-500/30",
  },
  {
    id: "DR",
    label: "Disaster Recovery",
    desc: "Failover / backup site",
    color: "#a855f7",
    bgClass: "bg-purple-500/10",
    textClass: "text-purple-400",
    borderClass: "border-purple-500/30",
  },
];

export function AddAssetButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState<AssetCategory>("SSH");
  const [environment, setEnvironment] = useState<Environment>("PROD");
  const [form, setForm] = useState({
    hostname: "",
    sshUser: "root",
    sshPort: 22,
    sshKey: "",
    sshPassword: "",
    sshAuthType: "key" as "key" | "password",
    dbType: "POSTGRES" as DbType,
    dbHost: "localhost",
    dbPort: 5432,
    dbName: "postgres",
    dbUser: "openshield_reader",
    dbPassword: "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (category === "APP") {
      toast.error("Akses Apps belum tersedia — coming soon");
      return;
    }
    setLoading(true);
    try {
      const body: any = {
        category,
        environment,
        hostname: form.hostname,
      };
      if (category === "SSH") {
        body.sshUser = form.sshUser || undefined;
        body.sshPort = form.sshPort;
        body.sshAuthType = form.sshAuthType;
        body.sshKey = form.sshAuthType === "key" ? form.sshKey : undefined;
        body.sshPassword =
          form.sshAuthType === "password" ? form.sshPassword : undefined;
      } else if (category === "DATABASE") {
        body.dbType = form.dbType;
        body.dbHost = form.dbHost;
        body.dbPort = form.dbPort;
        body.dbName = form.dbName;
        body.dbUser = form.dbUser;
        body.dbPassword = form.dbPassword;
      }
      const r = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        toast.error(d.error || "Gagal add asset");
        return;
      }
      toast.success(`Asset ${form.hostname} ditambahkan`);
      setOpen(false);
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  }

  function pickCategory(c: AssetCategory) {
    if (!CATEGORIES.find((x) => x.id === c)?.available) return;
    setCategory(c);
  }

  function pickDbType(t: Exclude<DbType, "NONE">) {
    setForm({
      ...form,
      dbType: t,
      dbPort: DB_DEFAULTS[t],
      dbName: t === "MYSQL" ? "mysql" : t === "SQLSERVER" ? "master" : "postgres",
    });
  }

  const activeCat = CATEGORIES.find((c) => c.id === category)!;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 h-9 px-4 rounded-lg bg-white text-black hover:bg-white/90 text-sm font-medium transition-all glow"
      >
        <Plus className="h-4 w-4" strokeWidth={2.5} />
        Add Asset
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-[var(--border-strong)] bg-[var(--background)] shadow-2xl"
          >
            {/* Header */}
            <div className="sticky top-0 flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--background)]/95 backdrop-blur z-10">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-white/[0.05] border border-[var(--border)] flex items-center justify-center">
                  <Server className="h-4 w-4" strokeWidth={2} />
                </div>
                <div>
                  <h2 className="text-base font-semibold">Add Asset</h2>
                  <p className="text-[10px] text-[var(--muted-foreground)] tracking-wide">
                    Pilih tipe akses yang mau di-monitor
                  </p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="h-8 w-8 rounded-lg hover:bg-white/[0.05] flex items-center justify-center text-[var(--muted)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Category tabs */}
            <div className="px-6 pt-5">
              <label className="block text-xs font-medium mb-2 text-[var(--muted-foreground)]">
                Tipe Akses
              </label>
              <div className="grid grid-cols-3 gap-2 p-1 rounded-xl bg-white/[0.03] border border-[var(--border)]">
                {CATEGORIES.map((c) => {
                  const active = category === c.id;
                  const Icon = c.icon;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => pickCategory(c.id)}
                      disabled={!c.available}
                      className={`relative flex flex-col items-start gap-1.5 p-3 rounded-lg text-left transition-all overflow-hidden ${
                        active
                          ? "bg-white text-black shadow-lg"
                          : c.available
                            ? "text-[var(--foreground)] hover:bg-white/[0.05]"
                            : "text-[var(--muted-foreground)] opacity-60 cursor-not-allowed"
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <Icon
                          className="h-4 w-4"
                          strokeWidth={active ? 2.25 : 1.75}
                        />
                        {c.badge && (
                          <span
                            className={`text-[9px] px-1.5 py-0.5 rounded-full font-mono uppercase tracking-wider ${
                              active
                                ? "bg-black/10 text-black/70"
                                : "bg-white/[0.08] text-[var(--muted-foreground)]"
                            }`}
                          >
                            {c.badge}
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-semibold leading-tight">
                        {c.label}
                      </div>
                      <div
                        className={`text-[10px] leading-tight ${
                          active ? "text-black/60" : "text-[var(--muted-foreground)]"
                        }`}
                      >
                        {c.desc}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Environment selector */}
            <div className="px-6 pt-4">
              <label className="flex items-center gap-1.5 text-xs font-medium mb-2 text-[var(--muted-foreground)]">
                <Globe className="h-3 w-3" />
                Environment
                <span className="text-[10px] text-[var(--muted-foreground)]/60 font-normal ml-1">
                  untuk grouping & alert routing
                </span>
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 p-1 rounded-xl bg-white/[0.03] border border-[var(--border)]">
                {ENVIRONMENTS.map((e) => {
                  const active = environment === e.id;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => setEnvironment(e.id)}
                      title={e.desc}
                      className={`relative flex flex-col items-center gap-1 p-2 rounded-lg text-left transition-all overflow-hidden ${
                        active
                          ? `${e.bgClass} ${e.textClass} ring-1 ring-inset`
                          : "text-[var(--muted-foreground)] hover:bg-white/[0.05] hover:text-[var(--foreground)]"
                      }`}
                      style={active ? { boxShadow: `inset 0 0 0 1px ${e.color}40` } : undefined}
                    >
                      <span className="text-[11px] font-semibold leading-tight font-mono tracking-wider">
                        {e.id}
                      </span>
                      <span className={`text-[9px] leading-tight text-center ${active ? "" : "opacity-70"}`}>
                        {e.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <form onSubmit={submit} className="p-6 space-y-5">
              <AnimatePresence mode="wait">
                {category === "APP" ? (
                  <motion.div
                    key="app-soon"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.18 }}
                    className="rounded-xl border border-dashed border-[var(--border-strong)] p-8 text-center bg-white/[0.02]"
                  >
                    <div className="inline-flex h-12 w-12 rounded-xl bg-white/[0.05] border border-[var(--border)] items-center justify-center mb-3">
                      <Sparkles className="h-5 w-5 text-[var(--muted-foreground)]" />
                    </div>
                    <h3 className="text-sm font-semibold">Coming Soon</h3>
                    <p className="mt-1 text-xs text-[var(--muted-foreground)] max-w-sm mx-auto">
                      Akses Apps lagi dalam development. Bisa monitor HTTP API
                      access, admin panel login, dan SaaS user activity.
                    </p>
                    <div className="mt-4 flex items-center justify-center gap-1.5 text-[10px] font-mono text-[var(--muted-foreground)]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--warning)] animate-pulse" />
                      planned Q3 2026
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key={category}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.18 }}
                    className="space-y-5"
                  >
                    {/* Hostname */}
                    <div>
                      <label className="block text-xs font-medium mb-1.5">
                        Hostname / IP <span className="text-[var(--danger)]">*</span>
                      </label>
                      <input
                        required
                        value={form.hostname}
                        onChange={(e) =>
                          setForm({ ...form, hostname: e.target.value })
                        }
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-mono focus:border-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                        placeholder="server.example.com atau 10.0.0.5"
                      />
                      <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">
                        Bisa hostname, public IP, atau private IP
                      </p>
                    </div>

                    {category === "SSH" && (
                      <div className="rounded-lg border border-[var(--border)] p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Key
                              className="h-4 w-4 text-emerald-500"
                              strokeWidth={1.75}
                            />
                            <h3 className="text-sm font-semibold">
                              SSH Monitoring
                            </h3>
                            <span className="text-[10px] text-[var(--muted-foreground)] uppercase tracking-wider">
                              required
                            </span>
                          </div>
                          <div className="flex gap-1 p-0.5 bg-white/[0.04] rounded-md">
                            <button
                              type="button"
                              onClick={() =>
                                setForm({ ...form, sshAuthType: "key" })
                              }
                              className={`text-[10px] px-2.5 py-1 rounded transition-all ${
                                form.sshAuthType === "key"
                                  ? "bg-white text-black font-medium"
                                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                              }`}
                            >
                              Key
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setForm({ ...form, sshAuthType: "password" })
                              }
                              className={`text-[10px] px-2.5 py-1 rounded transition-all ${
                                form.sshAuthType === "password"
                                  ? "bg-white text-black font-medium"
                                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                              }`}
                            >
                              Password
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                          <div className="col-span-2">
                            <label className="block text-[10px] font-medium text-[var(--muted-foreground)] mb-1">
                              SSH User
                            </label>
                            <input
                              value={form.sshUser}
                              onChange={(e) =>
                                setForm({ ...form, sshUser: e.target.value })
                              }
                              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-mono focus:border-[var(--foreground)] focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-medium text-[var(--muted-foreground)] mb-1">
                              Port
                            </label>
                            <input
                              type="number"
                              value={form.sshPort}
                              onChange={(e) =>
                                setForm({
                                  ...form,
                                  sshPort: parseInt(e.target.value) || 22,
                                })
                              }
                              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-mono focus:border-[var(--foreground)] focus:outline-none"
                            />
                          </div>
                        </div>

                        {form.sshAuthType === "key" ? (
                          <div>
                            <label className="block text-[10px] font-medium text-[var(--muted-foreground)] mb-1">
                              Private Key (PEM)
                            </label>
                            <textarea
                              value={form.sshKey}
                              onChange={(e) =>
                                setForm({ ...form, sshKey: e.target.value })
                              }
                              rows={4}
                              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px] font-mono focus:border-[var(--foreground)] focus:outline-none"
                              placeholder={
                                "-----BEGIN OPENSSH PRIVATE KEY-----\n..."
                              }
                            />
                            <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">
                              User harus bisa{" "}
                              <code className="text-[var(--foreground)]">
                                sudo cat /var/log/auth.log
                              </code>{" "}
                              (atau{" "}
                              <code className="text-[var(--foreground)]">
                                /var/log/secure
                              </code>{" "}
                              di RHEL)
                            </p>
                          </div>
                        ) : (
                          <div>
                            <label className="block text-[10px] font-medium text-[var(--muted-foreground)] mb-1">
                              Password
                            </label>
                            <input
                              type="password"
                              value={form.sshPassword}
                              onChange={(e) =>
                                setForm({
                                  ...form,
                                  sshPassword: e.target.value,
                                })
                              }
                              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-mono focus:border-[var(--foreground)] focus:outline-none"
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {category === "DATABASE" && (
                      <div className="rounded-lg border border-[var(--border)] p-4 space-y-3">
                        <div className="flex items-center gap-2">
                          <Database
                            className="h-4 w-4 text-blue-500"
                            strokeWidth={1.75}
                          />
                          <h3 className="text-sm font-semibold">
                            Database Login Monitoring
                          </h3>
                          <span className="text-[10px] text-[var(--muted-foreground)] uppercase tracking-wider">
                            required
                          </span>
                        </div>

                        {/* DB type sub-selector */}
                        <div className="grid grid-cols-3 gap-1.5 p-1 bg-white/[0.04] rounded-md">
                          {(["POSTGRES", "MYSQL", "SQLSERVER"] as Exclude<DbType, "NONE">[]).map(
                            (t) => (
                              <button
                                key={t}
                                type="button"
                                onClick={() => pickDbType(t)}
                                className={`text-[11px] py-1.5 rounded transition-all font-medium ${
                                  form.dbType === t
                                    ? "bg-white text-black"
                                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                                }`}
                              >
                                {t === "SQLSERVER" ? "SQL Server" : t.charAt(0) + t.slice(1).toLowerCase()}
                              </button>
                            ),
                          )}
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                          <div className="col-span-2">
                            <label className="block text-[10px] font-medium text-[var(--muted-foreground)] mb-1">
                              DB Host
                            </label>
                            <input
                              value={form.dbHost}
                              onChange={(e) =>
                                setForm({ ...form, dbHost: e.target.value })
                              }
                              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-mono focus:border-[var(--foreground)] focus:outline-none"
                              placeholder="localhost atau 10.0.0.5"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-medium text-[var(--muted-foreground)] mb-1">
                              Port
                            </label>
                            <input
                              type="number"
                              value={form.dbPort}
                              onChange={(e) =>
                                setForm({
                                  ...form,
                                  dbPort: parseInt(e.target.value) || 3306,
                                })
                              }
                              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-mono focus:border-[var(--foreground)] focus:outline-none"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[10px] font-medium text-[var(--muted-foreground)] mb-1">
                              Database
                            </label>
                            <input
                              value={form.dbName}
                              onChange={(e) =>
                                setForm({ ...form, dbName: e.target.value })
                              }
                              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-mono focus:border-[var(--foreground)] focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-medium text-[var(--muted-foreground)] mb-1">
                              User
                            </label>
                            <input
                              value={form.dbUser}
                              onChange={(e) =>
                                setForm({ ...form, dbUser: e.target.value })
                              }
                              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-mono focus:border-[var(--foreground)] focus:outline-none"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-[10px] font-medium text-[var(--muted-foreground)] mb-1">
                            Password
                          </label>
                          <input
                            type="password"
                            value={form.dbPassword}
                            onChange={(e) =>
                              setForm({ ...form, dbPassword: e.target.value })
                            }
                            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-mono focus:border-[var(--foreground)] focus:outline-none"
                          />
                          <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">
                            Pakai <strong>read-only</strong> role. Lo cuma butuh
                            login event monitoring, bukan query access.
                            {form.dbType === "POSTGRES" && (
                              <code className="block mt-1 text-[10px] text-[var(--foreground)]">
                                CREATE ROLE openshield_reader LOGIN PASSWORD
                                '...';
                              </code>
                            )}
                            {form.dbType === "MYSQL" && (
                              <code className="block mt-1 text-[10px] text-[var(--foreground)]">
                                CREATE USER 'openshield_reader'@'%' IDENTIFIED
                                BY '...'; GRANT PROCESS ON *.* TO ...;
                              </code>
                            )}
                            {form.dbType === "SQLSERVER" && (
                              <code className="block mt-1 text-[10px] text-[var(--foreground)]">
                                CREATE LOGIN openshield_reader WITH PASSWORD =
                                '...'; GRANT VIEW SERVER STATE TO ...;
                              </code>
                            )}
                          </p>
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {category !== "APP" && (
                <>
                  <div className="flex items-center gap-2 text-[10px] text-[var(--muted-foreground)] bg-white/[0.02] border border-[var(--border)] rounded-lg p-3">
                    <Lock className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                    <span>
                      Credentials di-encrypt pakai{" "}
                      <strong className="text-[var(--foreground)]">
                        AES-256-GCM
                      </strong>{" "}
                      server-side, never sent to browser
                    </span>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="flex-1 h-10 rounded-lg border border-[var(--border)] hover:bg-white/[0.04] text-sm font-medium transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading || !form.hostname}
                      className="flex-1 h-10 rounded-lg bg-white text-black hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium flex items-center justify-center gap-2 transition-all glow"
                    >
                      {loading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Plus className="h-4 w-4" strokeWidth={2.5} />
                          Add {activeCat.label}
                          <ArrowRight className="h-3.5 w-3.5 opacity-60" />
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}
            </form>
          </motion.div>
        </div>
      )}
    </>
  );
}
