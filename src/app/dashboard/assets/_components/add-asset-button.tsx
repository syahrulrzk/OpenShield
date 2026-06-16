"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, X, Server, Lock, Key, Database } from "lucide-react";
import { toast } from "sonner";

type DbType = "NONE" | "POSTGRES" | "MYSQL" | "SQLSERVER";

const DB_DEFAULTS: Record<Exclude<DbType, "NONE">, number> = {
  POSTGRES: 5432,
  MYSQL: 3306,
  SQLSERVER: 1433,
};

export function AddAssetButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    hostname: "",
    sshUser: "root",
    sshPort: 22,
    sshKey: "",
    sshPassword: "",
    sshAuthType: "key" as "key" | "password",
    dbType: "NONE" as DbType,
    dbHost: "localhost",
    dbPort: 5432,
    dbName: "postgres",
    dbUser: "openshield_reader",
    dbPassword: "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const body: any = {
        hostname: form.hostname,
        sshUser: form.sshUser || undefined,
        sshPort: form.sshPort,
        sshAuthType: form.sshAuthType,
        sshKey: form.sshAuthType === "key" ? form.sshKey : undefined,
        sshPassword: form.sshAuthType === "password" ? form.sshPassword : undefined,
        dbType: form.dbType,
      };
      if (form.dbType !== "NONE") {
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

  function setDbType(t: DbType) {
    setForm({
      ...form,
      dbType: t,
      dbPort: t === "NONE" ? form.dbPort : DB_DEFAULTS[t],
      dbName: t === "MYSQL" ? "mysql" : t === "SQLSERVER" ? "master" : "postgres",
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 h-9 px-4 rounded-lg bg-white text-black hover:bg-white/90 text-sm font-medium transition-all glow"
      >
        <Plus className="h-4 w-4" strokeWidth={2.5} />
        Add Server
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-[var(--border-strong)] bg-[var(--background)] shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--background)]/95 backdrop-blur z-10">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-white/[0.05] border border-[var(--border)] flex items-center justify-center">
                  <Server className="h-4 w-4" strokeWidth={2} />
                </div>
                <div>
                  <h2 className="text-base font-semibold">Add Server</h2>
                  <p className="text-[10px] text-[var(--muted-foreground)] tracking-wide">
                    Monitor SSH & database logins
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

            <form onSubmit={submit} className="p-6 space-y-5">
              {/* Hostname */}
              <div>
                <label className="block text-xs font-medium mb-1.5">
                  Hostname / IP <span className="text-[var(--danger)]">*</span>
                </label>
                <input
                  required
                  value={form.hostname}
                  onChange={(e) => setForm({ ...form, hostname: e.target.value })}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-mono focus:border-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                  placeholder="server.example.com atau 10.0.0.5"
                />
                <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">
                  Bisa hostname, public IP, atau private IP
                </p>
              </div>

              {/* SSH section */}
              <div className="rounded-lg border border-[var(--border)] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Key className="h-4 w-4 text-[var(--success)]" strokeWidth={1.75} />
                    <h3 className="text-sm font-semibold">SSH Monitoring</h3>
                    <span className="text-[10px] text-[var(--muted-foreground)] uppercase tracking-wider">optional</span>
                  </div>
                  <div className="flex gap-1 p-0.5 bg-white/[0.04] rounded-md">
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, sshAuthType: "key" })}
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
                      onClick={() => setForm({ ...form, sshAuthType: "password" })}
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
                      onChange={(e) => setForm({ ...form, sshUser: e.target.value })}
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
                      onChange={(e) => setForm({ ...form, sshPort: parseInt(e.target.value) || 22 })}
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
                      onChange={(e) => setForm({ ...form, sshKey: e.target.value })}
                      rows={4}
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px] font-mono focus:border-[var(--foreground)] focus:outline-none"
                      placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n..."}
                    />
                    <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">
                      User harus bisa <code className="text-[var(--foreground)]">sudo cat /var/log/auth.log</code> (atau <code className="text-[var(--foreground)]">/var/log/secure</code> di RHEL)
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
                      onChange={(e) => setForm({ ...form, sshPassword: e.target.value })}
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-mono focus:border-[var(--foreground)] focus:outline-none"
                    />
                  </div>
                )}
              </div>

              {/* Database section */}
              <div className="rounded-lg border border-[var(--border)] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-[var(--info)]" strokeWidth={1.75} />
                    <h3 className="text-sm font-semibold">Database Login Monitoring</h3>
                    <span className="text-[10px] text-[var(--muted-foreground)] uppercase tracking-wider">optional</span>
                  </div>
                </div>

                {/* DB type selector */}
                <div className="grid grid-cols-4 gap-1.5 p-1 bg-white/[0.04] rounded-md">
                  {(["NONE", "POSTGRES", "MYSQL", "SQLSERVER"] as DbType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setDbType(t)}
                      className={`text-[11px] py-1.5 rounded transition-all font-medium ${
                        form.dbType === t
                          ? "bg-white text-black"
                          : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      {t === "NONE" ? "None" : t === "SQLSERVER" ? "SQL Server" : t.charAt(0) + t.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>

                {form.dbType !== "NONE" && (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-2">
                        <label className="block text-[10px] font-medium text-[var(--muted-foreground)] mb-1">
                          DB Host
                        </label>
                        <input
                          value={form.dbHost}
                          onChange={(e) => setForm({ ...form, dbHost: e.target.value })}
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
                          onChange={(e) => setForm({ ...form, dbPort: parseInt(e.target.value) || 3306 })}
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
                          onChange={(e) => setForm({ ...form, dbName: e.target.value })}
                          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-mono focus:border-[var(--foreground)] focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-[var(--muted-foreground)] mb-1">
                          User
                        </label>
                        <input
                          value={form.dbUser}
                          onChange={(e) => setForm({ ...form, dbUser: e.target.value })}
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
                        onChange={(e) => setForm({ ...form, dbPassword: e.target.value })}
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-mono focus:border-[var(--foreground)] focus:outline-none"
                      />
                      <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">
                        Pakai <strong>read-only</strong> role. Lo cuma butuh login event monitoring, bukan query access.
                        {form.dbType === "POSTGRES" && (
                          <code className="block mt-1 text-[10px] text-[var(--foreground)]">
                            CREATE ROLE openshield_reader LOGIN PASSWORD '...';
                          </code>
                        )}
                        {form.dbType === "MYSQL" && (
                          <code className="block mt-1 text-[10px] text-[var(--foreground)]">
                            CREATE USER 'openshield_reader'@'%' IDENTIFIED BY '...'; GRANT PROCESS ON *.* TO ...;
                          </code>
                        )}
                        {form.dbType === "SQLSERVER" && (
                          <code className="block mt-1 text-[10px] text-[var(--foreground)]">
                            CREATE LOGIN openshield_reader WITH PASSWORD = '...'; GRANT VIEW SERVER STATE TO ...;
                          </code>
                        )}
                      </p>
                    </div>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2 text-[10px] text-[var(--muted-foreground)] bg-white/[0.02] border border-[var(--border)] rounded-lg p-3">
                <Lock className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                <span>
                  Credentials di-encrypt pakai <strong className="text-[var(--foreground)]">AES-256-GCM</strong> server-side, never sent to browser
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
                    <Plus className="h-4 w-4" strokeWidth={2.5} />
                  )}
                  Add Server
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
