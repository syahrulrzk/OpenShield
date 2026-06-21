"use client";

/**
 * EditAssetModal — Edit existing database asset (metadata only)
 *
 * Editable fields:
 *   - displayName, environment, role, location, description, tags
 *   - monitorAllDatabases (toggle Opsi B multi-DB scan)
 *
 * NOT editable here (to keep simple + secure):
 *   - hostname, dbType, dbHost, dbPort, dbName, dbUser, password
 *   - To change connection, delete and re-create the asset
 *
 * On submit:
 *   1. PATCH /api/assets/[id]
 *   2. Server re-validates displayName uniqueness
 *   3. Server returns diff
 *   4. Audit log: asset.update with old/new per field
 *   5. Closes modal, calls onUpdated() → parent calls router.refresh()
 */

import { useState } from "react";
import { X, Loader2, CheckCircle2, AlertCircle, Pencil } from "lucide-react";
import { toast } from "sonner";

type AssetInput = {
  id: string;
  displayName: string | null;
  environment: string;
  role: string | null;
  location: string | null;
  description: string | null;
  tags: string[];
  monitorAllDatabases?: boolean;
  discoveredDatabases?: string[] | null;
  auditConnectionLog?: boolean;
  dbType?: string;
};

export function EditAssetModal({
  asset,
  onClose,
  onUpdated,
}: {
  asset: AssetInput;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [displayName, setDisplayName] = useState(asset.displayName ?? "");
  const [environment, setEnvironment] = useState<
    "PROD" | "STAGING" | "UAT"
  >(asset.environment as "PROD" | "STAGING" | "UAT");
  const [role, setRole] = useState(asset.role ?? "");
  const [location, setLocation] = useState(asset.location ?? "");
  const [description, setDescription] = useState(asset.description ?? "");
  const [tags, setTags] = useState(
    Array.isArray(asset.tags) ? asset.tags.join(", ") : ""
  );
  const [monitorAllDatabases, setMonitorAllDatabases] = useState(
    asset.monitorAllDatabases ?? false
  );
  const [auditConnectionLog, setAuditConnectionLog] = useState(
    asset.auditConnectionLog ?? false
  );

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        environment,
        role: role.trim() || null,
        location: location.trim() || null,
        description: description.trim() || null,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        // Only include if it changed (avoids reset of discoveredDatabases
        // when other fields are edited)
        ...(monitorAllDatabases !== (asset.monitorAllDatabases ?? false) && {
          monitorAllDatabases,
        }),
        ...(auditConnectionLog !== (asset.auditConnectionLog ?? false) && {
          auditConnectionLog,
        }),
      };
      if (displayName.trim() && displayName.trim() !== asset.displayName) {
        body.displayName = displayName.trim();
      }

      const r = await fetch(`/api/assets/${asset.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        throw new Error(
          data.details
            ? Object.entries(data.details)
                .map(
                  ([k, v]: [string, unknown]) =>
                    `${k}: ${(v as string[]).join(", ")}`
                )
                .join("; ")
            : data.error || `HTTP ${r.status}`
        );
      }
      const changed = Object.keys(data.diff ?? {}).length;
      toast.success(
        changed > 0
          ? `Asset updated (${changed} field${changed > 1 ? "s" : ""} changed)`
          : "No changes"
      );
      onUpdated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      toast.error(
        `Failed to update: ${e instanceof Error ? e.message : String(e)}`
      );
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
            <Pencil className="h-4 w-4 text-violet-400" />
            <h2 className="text-base font-semibold">Edit Asset</h2>
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
          <p className="text-[11px] text-[var(--muted-foreground)] -mt-2">
            Connection details (host, port, db, user, password) cannot be
            changed here. To change, delete and re-create the asset.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Display name">
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={64}
                disabled={busy}
                className="modal-input"
              />
            </Field>
            <Field label="Environment">
              <select
                value={environment}
                onChange={(e) =>
                  setEnvironment(e.target.value as typeof environment)
                }
                disabled={busy}
                className="modal-input"
              >
                <option value="PROD">Production</option>
                <option value="STAGING">Staging</option>
                <option value="UAT">UAT</option>
              </select>
            </Field>
          </div>

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

          <Field
            label="Scan mode"
            hint={
              asset.discoveredDatabases && asset.discoveredDatabases.length > 0
                ? `Currently scanning ${asset.discoveredDatabases.length} DB(s): ${asset.discoveredDatabases.slice(0, 3).join(", ")}${asset.discoveredDatabases.length > 3 ? "…" : ""}`
                : "Opsi B: monitor all databases on this server"
            }
          >
            <label
              className={`flex items-start gap-2 h-9 px-3 rounded-md border border-dashed cursor-pointer transition-colors ${
                monitorAllDatabases
                  ? "border-violet-500/50 bg-violet-500/10"
                  : "border-[var(--border)] bg-[var(--surface-2)]"
              }`}
            >
              <input
                type="checkbox"
                checked={monitorAllDatabases}
                onChange={(e) => setMonitorAllDatabases(e.target.checked)}
                disabled={busy}
                className="mt-1.5"
              />
              <div className="flex-1 leading-tight pt-1">
                <div className="text-[11px] font-medium text-zinc-200">
                  Monitor all databases on this server
                </div>
                <div className="text-[10px] text-zinc-500">
                  {monitorAllDatabases
                    ? "Scan all user DBs · auto-discover new ones"
                    : "Single database mode (only dbName is polled)"}
                </div>
              </div>
            </label>
          </Field>

          {/* Audit connection log (MySQL only) */}
          {asset.dbType === "MYSQL" && (
            <Field
              label="Audit log"
              hint={
                auditConnectionLog
                  ? "Capturing connect/disconnect events"
                  : "Disabled"
              }
            >
              <label
                className={`flex items-start gap-2 h-auto px-3 py-2 rounded-md border border-dashed cursor-pointer transition-colors ${
                  auditConnectionLog
                    ? "border-amber-500/50 bg-amber-500/10"
                    : "border-[var(--border)] bg-[var(--surface-2)]"
                }`}
              >
                <input
                  type="checkbox"
                  checked={auditConnectionLog}
                  onChange={(e) =>
                    setAuditConnectionLog(e.target.checked)
                  }
                  disabled={busy}
                  className="mt-1"
                />
                <div className="flex-1 leading-tight pt-0.5">
                  <div className="text-[11px] font-medium text-zinc-200">
                    Capture connect / disconnect events
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    Real-time auth events (success + failed) · skips query bodies
                  </div>
                  {auditConnectionLog && (
                    <details className="mt-2 text-[10px] text-zinc-400">
                      <summary className="cursor-pointer text-amber-300 hover:text-amber-200">
                        Required on target MySQL
                      </summary>
                      <pre className="mt-1.5 p-2 rounded bg-black/40 text-[10px] font-mono text-zinc-300 whitespace-pre overflow-x-auto">
{`SET GLOBAL log_output = 'TABLE';
SET GLOBAL general_log = 'ON';`}
                      </pre>
                    </details>
                  )}
                </div>
              </label>
            </Field>
          )}

          <Field label="Description" hint="optional, max 512 chars">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={512}
              disabled={busy}
              rows={3}
              className="modal-input"
            />
          </Field>

          {err && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span className="whitespace-pre-wrap break-all">{err}</span>
            </div>
          )}

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
              className="h-9 px-4 rounded-lg bg-violet-500 text-white text-xs font-semibold hover:bg-violet-600 disabled:opacity-50 disabled:cursor-wait flex items-center gap-1.5"
            >
              {busy ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Save changes
                </>
              )}
            </button>
          </div>
        </form>

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
          :global(textarea.modal-input) {
            height: auto;
            padding: 0.5rem 0.75rem;
            resize: vertical;
            font-family: inherit;
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
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
        {label}
      </label>
      {children}
      {hint && <p className="text-[10px] text-zinc-600 mt-1">{hint}</p>}
    </div>
  );
}