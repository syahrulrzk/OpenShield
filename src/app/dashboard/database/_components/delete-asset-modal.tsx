"use client";

/**
 * DeleteAssetModal — Confirmation dialog for deleting an asset
 *
 * Safety: requires user to TYPE the asset displayName to enable delete
 * (prevents accidental clicks, especially on rows with many events)
 *
 * Behavior:
 *   - Shows asset info (name, env, type, event count)
 *   - Type asset name to enable Delete button
 *   - DELETE /api/assets/[id] with body { confirm: true }
 *   - Cascades: deletes AssetCredential (encrypted password gone)
 *   - Preserves: DbEvents history (set assetId = null)
 *   - Audit log: asset.delete with metadata
 *
 * Visual: red border + destructive button styling
 */

import { useState } from "react";
import { X, Trash2, Loader2, AlertTriangle, AlertCircle } from "lucide-react";
import { toast } from "sonner";

type AssetDeleteInfo = {
  id: string;
  displayName: string | null;
  hostname: string;
  environment: string;
  dbType: string;
  eventCount: number;
};

export function DeleteAssetModal({
  asset,
  onClose,
  onDeleted,
}: {
  asset: AssetDeleteInfo;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const name = asset.displayName ?? asset.hostname;
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const matches = confirmText === name;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matches) {
      setErr(`Type "${name}" exactly to confirm`);
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const r = await fetch(`/api/assets/${asset.id}`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${r.status}`);
      }
      toast.success(
        `Asset "${name}" deleted. ${data.deleted.credentialsDeleted} credential(s) removed. ${data.deleted.eventsPreserved} event(s) preserved in history.`
      );
      onDeleted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      toast.error(
        `Failed to delete: ${e instanceof Error ? e.message : String(e)}`
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
        className="w-full max-w-md bg-[var(--surface)] border border-red-500/30 rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-red-500/20">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-full bg-red-500/10 flex items-center justify-center">
              <Trash2 className="h-3.5 w-3.5 text-red-400" />
            </div>
            <h2 className="text-base font-semibold text-red-300">
              Delete Asset
            </h2>
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
          {/* Warning banner */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
            <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
            <div className="text-xs text-red-200 space-y-1">
              <p className="font-semibold">This action will:</p>
              <ul className="list-disc list-inside space-y-0.5 text-red-300/90">
                <li>
                  Delete the asset and its <strong>encrypted credentials</strong>
                </li>
                <li>Stop all future polling for this database</li>
                <li>
                  Preserve {asset.eventCount} historical event(s) in the
                  audit log
                </li>
                <li>Log this deletion to the audit trail</li>
              </ul>
            </div>
          </div>

          {/* Asset info card */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                Display Name
              </span>
              <span className="text-sm font-medium text-zinc-100">
                {name}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                Environment
              </span>
              <span className="text-xs font-mono text-zinc-300">
                {asset.environment}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                Type
              </span>
              <span className="text-xs font-mono text-zinc-300">
                {asset.dbType}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                Hostname
              </span>
              <span className="text-[10px] font-mono text-zinc-500 truncate ml-2 max-w-[200px]">
                {asset.hostname}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                Events
              </span>
              <span className="text-xs font-mono text-zinc-300">
                {asset.eventCount}
              </span>
            </div>
          </div>

          {/* Type-to-confirm */}
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
              Type{" "}
              <span className="font-mono text-red-300 normal-case">
                {name}
              </span>{" "}
              to confirm
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              disabled={busy}
              autoFocus
              autoComplete="off"
              className="w-full h-9 px-3 rounded-md bg-[var(--surface-2)] border border-[var(--border)] text-xs font-mono focus:outline-none focus:ring-2 focus:ring-red-500/40 focus:border-red-500/50 disabled:opacity-50"
            />
            {confirmText && !matches && (
              <p className="text-[10px] text-amber-400 mt-1">
                Name doesn't match — keep typing
              </p>
            )}
            {matches && (
              <p className="text-[10px] text-[var(--success)] mt-1">
                ✓ Name confirmed
              </p>
            )}
          </div>

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
              disabled={busy || !matches}
              className="h-9 px-4 rounded-lg bg-red-500 text-white text-xs font-semibold hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {busy ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete permanently
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}