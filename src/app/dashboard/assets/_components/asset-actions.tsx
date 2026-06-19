"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, Loader2, X, Save, AlertTriangle } from "lucide-react";

type Asset = {
  id: string;
  category: string;
  environment: string;
  displayName?: string | null;
  hostname: string;
  publicIp: string | null;
  privateIp: string | null;
  os: string | null;
  kernel: string | null;
  sshPort: number;
  sshUser: string | null;
  dbType: string;
  dbHost: string | null;
  dbPort: number | null;
  dbName: string | null;
  dbUser: string | null;
};

const ENV_OPTIONS = ["PROD", "STAGING", "UAT", "DEV", "DR"] as const;

export function AssetActions({ asset }: { asset: Asset }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/assets/${asset.id}`, { method: "DELETE" });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? `HTTP ${res.status}`);
        }
        setConfirmDelete(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal hapus asset");
      }
    });
  }

  return (
    <>
      {/* Action buttons — show in both table row & card */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Edit ${asset.hostname}`}
          className="h-8 w-8 rounded-lg hover:bg-white/[0.06] text-[var(--muted-foreground)] hover:text-[var(--foreground)] flex items-center justify-center transition-colors"
          title="Edit"
        >
          <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          aria-label={`Delete ${asset.hostname}`}
          className="h-8 w-8 rounded-lg hover:bg-red-500/10 text-[var(--muted-foreground)] hover:text-red-500 flex items-center justify-center transition-colors"
          title="Hapus"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>

      {/* Edit modal */}
      {editing && (
        <EditModal
          asset={asset}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            router.refresh();
          }}
        />
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => !pending && setConfirmDelete(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-4 w-4 text-red-500" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold">Hapus asset?</h3>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  <span className="font-mono text-[var(--foreground)]">{asset.hostname}</span>{" "}
                  akan dihapus permanen, termasuk semua event SSH/DB history & alerts.
                </p>
                {error && (
                  <p className="mt-2 text-xs text-red-500">{error}</p>
                )}
              </div>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirmDelete(false)}
                className="h-9 px-3 rounded-lg text-xs font-medium hover:bg-white/[0.05] text-[var(--muted-foreground)] disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={handleDelete}
                className="h-9 px-4 rounded-lg text-xs font-medium bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 flex items-center gap-1.5"
              >
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Hapus permanen
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function EditModal({
  asset,
  onClose,
  onSaved,
}: {
  asset: Asset;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    hostname: asset.hostname,
    environment: asset.environment,
    displayName: asset.displayName ?? "",
    publicIp: asset.publicIp ?? "",
    privateIp: asset.privateIp ?? "",
    os: asset.os ?? "",
    kernel: asset.kernel ?? "",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch(`/api/assets/${asset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostname: form.hostname,
          environment: form.environment,
          displayName: form.displayName.trim() || null,
          publicIp: form.publicIp || null,
          privateIp: form.privateIp || null,
          os: form.os || null,
          kernel: form.kernel || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal update asset");
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm overflow-y-auto"
      onClick={() => !pending && onClose()}
    >
      <div
        className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--background)] shadow-2xl my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h2 className="text-sm font-semibold">Edit Asset</h2>
            <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5 font-mono">
              {asset.id}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="h-8 w-8 rounded-lg hover:bg-white/[0.05] flex items-center justify-center text-[var(--muted-foreground)] disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <Field label="Hostname">
            <input
              type="text"
              required
              value={form.hostname}
              onChange={(e) => setForm({ ...form, hostname: e.target.value })}
              className="w-full h-9 px-3 rounded-lg bg-white/[0.03] border border-[var(--border)] text-sm font-mono focus:outline-none focus:border-[var(--accent)]"
            />
          </Field>

          <Field label="Display Name (alias)">
            <input
              type="text"
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              placeholder={asset.hostname}
              className="w-full h-9 px-3 rounded-lg bg-white/[0.03] border border-[var(--border)] text-sm font-mono focus:outline-none focus:border-[var(--accent)]"
            />
            <span className="block mt-1 text-[10px] text-[var(--muted-foreground)]">
              Mis. <code>prod-web-01</code>. Kosongkan → pakai hostname.
            </span>
          </Field>

          <Field label="Environment">
            <select
              value={form.environment}
              onChange={(e) => setForm({ ...form, environment: e.target.value })}
              className="w-full h-9 px-3 rounded-lg bg-white/[0.03] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--accent)]"
            >
              {ENV_OPTIONS.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Host IP (public)">
              <input
                type="text"
                value={form.publicIp}
                onChange={(e) => setForm({ ...form, publicIp: e.target.value })}
                placeholder="10.0.0.5"
                className="w-full h-9 px-3 rounded-lg bg-white/[0.03] border border-[var(--border)] text-sm font-mono focus:outline-none focus:border-[var(--accent)]"
              />
            </Field>
            <Field label="Private IP (opsional)">
              <input
                type="text"
                value={form.privateIp}
                onChange={(e) => setForm({ ...form, privateIp: e.target.value })}
                placeholder="192.168.x.x"
                className="w-full h-9 px-3 rounded-lg bg-white/[0.03] border border-[var(--border)] text-sm font-mono focus:outline-none focus:border-[var(--accent)]"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="OS">
              <input
                type="text"
                value={form.os}
                onChange={(e) => setForm({ ...form, os: e.target.value })}
                placeholder="Ubuntu 24.04"
                className="w-full h-9 px-3 rounded-lg bg-white/[0.03] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--accent)]"
              />
            </Field>
            <Field label="Kernel">
              <input
                type="text"
                value={form.kernel}
                onChange={(e) => setForm({ ...form, kernel: e.target.value })}
                placeholder="6.8.0-…"
                className="w-full h-9 px-3 rounded-lg bg-white/[0.03] border border-[var(--border)] text-sm font-mono focus:outline-none focus:border-[var(--accent)]"
              />
            </Field>
          </div>

          <p className="text-[11px] text-[var(--muted-foreground)] leading-relaxed">
            💡 Category & credential type tidak bisa diubah di sini (hardening
            policy). Untuk ganti category, hapus lalu tambah ulang.
          </p>

          {error && (
            <p className="text-xs text-red-500 bg-red-500/10 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="h-9 px-3 rounded-lg text-xs font-medium hover:bg-white/[0.05] text-[var(--muted-foreground)] disabled:opacity-50"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={pending}
              className="h-9 px-4 rounded-lg text-xs font-medium bg-[var(--accent)] text-black hover:bg-[var(--accent)]/90 disabled:opacity-50 flex items-center gap-1.5"
            >
              {pending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Simpan
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-[var(--muted-foreground)] mb-1.5 uppercase tracking-wide">
        {label}
      </span>
      {children}
    </label>
  );
}
