"use client";

/**
 * AddAssetModal — Form to add a new DATABASE (or SSH) asset
 *
 * Required fields for DATABASE:
 *   - displayName (1-64 chars, unique per user)
 *   - environment (PROD/STAGING/UAT)
 *   - dbType (POSTGRES/MYSQL/SQLSERVER)
 *   - dbHost + dbPort + dbName + dbUser + password
 *
 * Optional: hostname (auto-generated if empty), role, location,
 *           description, tags, testConnection (default true)
 *
 * On submit:
 *   1. POST /api/assets
 *   2. Server tests connection (unless testConnection=false)
 *   3. Encrypts password via AES-256-GCM
 *   4. Creates Asset + AssetCredential rows
 *   5. Audit logs: asset.create, credential.create
 *   6. Closes modal, calls onCreated()
 */

import { useState } from "react";
import { X, Database, Eye, EyeOff, Loader2, CheckCircle2, AlertCircle, Plus } from "lucide-react";
import { toast } from "sonner";

type DbType = "POSTGRES" | "MYSQL" | "SQLSERVER";

const DB_TYPE_META: Record<DbType, { label: string; defaultPort: number; sampleUser: string }> = {
  POSTGRES: { label: "PostgreSQL", defaultPort: 5432, sampleUser: "openshield" },
  MYSQL: { label: "MySQL / MariaDB", defaultPort: 3306, sampleUser: "openshield" },
  SQLSERVER: { label: "SQL Server", defaultPort: 1433, sampleUser: "openshield" },
};

export function AddAssetModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [environment, setEnvironment] = useState<"PROD" | "STAGING" | "UAT">("PROD");
  const [dbType, setDbType] = useState<DbType>("POSTGRES");
  const [dbHost, setDbHost] = useState("");
  const [dbPort, setDbPort] = useState<number>(DB_TYPE_META.POSTGRES.defaultPort);
  const [dbName, setDbName] = useState("");
  const [dbUser, setDbUser] = useState(DB_TYPE_META.POSTGRES.sampleUser);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [testConnection, setTestConnection] = useState(true);
  const [role, setRole] = useState("");
  const [location, setLocation] = useState("");
  const [tags, setTags] = useState("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Change dbType → reset port to default
  const onDbTypeChange = (next: DbType) => {
    setDbType(next);
    setDbPort(DB_TYPE_META[next].defaultPort);
    setDbUser(DB_TYPE_META[next].sampleUser);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);

    if (!displayName.trim()) {
      setErr("Display name is required");
      return;
    }
    if (!dbHost.trim() || !dbName.trim() || !dbUser.trim() || !password) {
      setErr("DB Host, Database, Username, and Password are required");
      return;
    }

    setBusy(true);
    try {
      const body = {
        displayName: displayName.trim(),
        environment,
        category: "DATABASE",
        dbType,
        dbHost: dbHost.trim(),
        dbPort,
        dbName: dbName.trim(),
        dbUser: dbUser.trim(),
        password,
        testConnection,
        role: role.trim() || undefined,
        location: location.trim() || undefined,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      };

      const r = await fetch("/api/assets", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        throw new Error(
          data.details
            ? Object.entries(data.details)
                .map(([k, v]: [string, unknown]) => `${k}: ${(v as string[]).join(", ")}`)
                .join("; ")
            : data.error || `HTTP ${r.status}`
        );
      }
      toast.success(
        `Asset "${data.asset.displayName}" added. Status: ${data.asset.status}`
      );
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      toast.error(`Failed to add asset: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-[var(--primary)]" />
            <h2 className="text-base font-semibold">Add Database Asset</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="p-5 space-y-4">
          {/* Display name + Environment */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Display name *" hint="e.g. prod-pg-jkt-01">
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={64}
                placeholder="prod-pg-jkt-01"
                disabled={busy}
                className="modal-input"
              />
            </Field>
            <Field label="Environment *">
              <select
                value={environment}
                onChange={(e) => setEnvironment(e.target.value as typeof environment)}
                disabled={busy}
                className="modal-input"
              >
                <option value="PROD">Production</option>
                <option value="STAGING">Staging</option>
                <option value="UAT">UAT</option>
              </select>
            </Field>
          </div>

          {/* DB Type */}
          <Field label="DB type *">
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(DB_TYPE_META) as DbType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => onDbTypeChange(t)}
                  disabled={busy}
                  className={`h-10 px-2 rounded-lg border text-xs font-medium transition-colors ${
                    dbType === t
                      ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]"
                      : "border-[var(--border)] bg-[var(--surface-2)] text-zinc-400 hover:border-zinc-600"
                  }`}
                >
                  {DB_TYPE_META[t].label}
                </button>
              ))}
            </div>
          </Field>

          {/* DB connection */}
          <div className="grid grid-cols-3 gap-3">
            <Field label="DB host *" colSpan={2}>
              <input
                type="text"
                value={dbHost}
                onChange={(e) => setDbHost(e.target.value)}
                placeholder="10.0.1.50 or db.example.com"
                disabled={busy}
                className="modal-input"
              />
            </Field>
            <Field label="Port *">
              <input
                type="number"
                value={dbPort}
                onChange={(e) => setDbPort(parseInt(e.target.value, 10) || 0)}
                min={1}
                max={65535}
                disabled={busy}
                className="modal-input"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Database name *" hint="Default DB to monitor">
              <input
                type="text"
                value={dbName}
                onChange={(e) => setDbName(e.target.value)}
                placeholder="app, postgres, master, …"
                disabled={busy}
                className="modal-input"
              />
            </Field>
            <Field label="Username *" hint="Create with read-only grants">
              <input
                type="text"
                value={dbUser}
                onChange={(e) => setDbUser(e.target.value)}
                disabled={busy}
                className="modal-input"
              />
            </Field>
          </div>

          <Field label="Password *" hint="Encrypted at rest with AES-256-GCM">
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                autoComplete="new-password"
                className="modal-input pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                title={showPassword ? "Hide" : "Show"}
              >
                {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </Field>

          {/* Optional metadata */}
          <details className="text-xs">
            <summary className="cursor-pointer text-zinc-400 hover:text-zinc-200 select-none">
              Optional metadata
            </summary>
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Role" hint="web/db/cache/…">
                  <input
                    type="text"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    maxLength={64}
                    disabled={busy}
                    className="modal-input"
                  />
                </Field>
                <Field label="Location" hint="jkt/sg/aws-ap-southeast/…">
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    maxLength={128}
                    disabled={busy}
                    className="modal-input"
                  />
                </Field>
              </div>
              <Field label="Tags" hint="comma-separated">
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="tier-1, payment, critical"
                  disabled={busy}
                  className="modal-input"
                />
              </Field>
            </div>
          </details>

          {/* Test connection toggle */}
          <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={testConnection}
              onChange={(e) => setTestConnection(e.target.checked)}
              disabled={busy}
              className="rounded border-zinc-600 bg-zinc-800 text-[var(--primary)] focus:ring-[var(--primary)]"
            />
            Test connection before saving
            <span className="text-zinc-600">(recommended)</span>
          </label>

          {/* Error */}
          {err && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span className="whitespace-pre-wrap break-all">{err}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="h-9 px-4 rounded-lg text-xs font-medium text-zinc-300 hover:bg-white/[0.04] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="h-9 px-4 rounded-lg bg-[var(--primary)] text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-wait flex items-center gap-1.5"
            >
              {busy ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Testing & saving…
                </>
              ) : testConnection ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Add asset
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5" />
                  Add asset
                </>
              )}
            </button>
          </div>
        </form>

        {/* Inline styles for inputs */}
        <style jsx>{`
          :global(.modal-input) {
            width: 100%;
            height: 2.25rem;
            padding: 0 0.75rem;
            border-radius: 0.5rem;
            background: var(--surface-2, rgba(255, 255, 255, 0.04));
            border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
            color: var(--foreground, #fff);
            font-size: 0.75rem;
            outline: none;
          }
          :global(.modal-input:focus) {
            border-color: var(--primary, #6366f1);
            box-shadow: 0 0 0 2px var(--primary, #6366f1) 40;
          }
          :global(.modal-input:disabled) {
            opacity: 0.5;
            cursor: not-allowed;
          }
        `}</style>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
  colSpan,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  colSpan?: 1 | 2;
}) {
  return (
    <div className={colSpan === 2 ? "sm:col-span-2" : ""}>
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
        {label}
      </label>
      {children}
      {hint && <p className="text-[10px] text-zinc-600 mt-1">{hint}</p>}
    </div>
  );
}
