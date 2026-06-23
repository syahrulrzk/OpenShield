"use client";

/**
 * NetworkDeviceModal — Add / Edit modal for network assets
 *
 * Used by NetworkDevicesTable. Fields mirror prisma Asset model for
 * category=NETWORK: vendor, model, firmware, mgmtIp, syslogPort, sshEnabled,
 * plus standard identity (displayName, hostname, environment, location, role,
 * description).
 *
 * Submits to:
 *   POST   /api/assets (create)
 *   PATCH  /api/assets/[id] (edit)
 */

import { useEffect, useState } from "react";
import { Loader2, X, Network } from "lucide-react";

const VENDORS = [
  { value: "cisco", label: "Cisco" },
  { value: "mikrotik", label: "MikroTik" },
  { value: "fortinet", label: "Fortinet" },
  { value: "juniper", label: "Juniper" },
  { value: "paloalto", label: "Palo Alto" },
  { value: "ubiquiti", label: "Ubiquiti" },
  { value: "hp", label: "HP / Aruba" },
  { value: "huawei", label: "Huawei" },
  { value: "generic", label: "Generic / Other" },
] as const;

const ENVIRONMENTS = [
  { value: "PROD", label: "Production" },
  { value: "STAGING", label: "Staging" },
  { value: "UAT", label: "UAT" },
  { value: "DEV", label: "Dev" },
  { value: "DR", label: "DR" },
] as const;

type DevicePayload = {
  id?: string;
  displayName: string;
  hostname: string;
  vendor: string;
  model: string;
  firmware: string;
  mgmtIp: string;
  syslogPort: number;
  sshEnabled: boolean;
  environment: string;
  location: string;
  role: string;
  description: string;
};

export function NetworkDeviceModal({
  mode,
  device,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  device?: any;
  onClose: () => void;
  onSaved: (d: any) => void;
}) {
  const [form, setForm] = useState<DevicePayload>({
    displayName: device?.displayName ?? "",
    hostname: device?.hostname ?? "",
    vendor: device?.vendor ?? "cisco",
    model: device?.model ?? "",
    firmware: device?.firmware ?? "",
    mgmtIp: device?.mgmtIp ?? "",
    syslogPort: device?.syslogPort ?? 514,
    sshEnabled: device?.sshEnabled ?? false,
    environment: device?.environment ?? "PROD",
    location: device?.location ?? "",
    role: device?.role ?? "",
    description: device?.description ?? "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lock body scroll when modal open
  useEffect(() => {
    const orig = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = orig;
    };
  }, []);

  const upd = (key: keyof DevicePayload, value: any) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      // Basic client-side validation
      if (!form.displayName.trim()) throw new Error("Display name required");
      if (!form.hostname.trim()) throw new Error("Hostname required");
      if (form.mgmtIp && !/^(\d{1,3}\.){3}\d{1,3}$/.test(form.mgmtIp.trim())) {
        throw new Error("Mgmt IP must be a valid IPv4 address (or leave empty)");
      }

      const body: any = {
        category: "NETWORK",
        displayName: form.displayName.trim(),
        hostname: form.hostname.trim(),
        environment: form.environment,
        location: form.location || null,
        role: form.role || null,
        description: form.description || null,
        vendor: form.vendor,
        model: form.model || null,
        firmware: form.firmware || null,
        mgmtIp: form.mgmtIp || null,
        syslogPort: form.syslogPort,
        sshEnabled: form.sshEnabled,
      };
      const url = mode === "create" ? "/api/assets" : `/api/assets/${device.id}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");

      onSaved(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-zinc-950 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)] sticky top-0 bg-zinc-950 z-10">
          <div className="flex items-center gap-2">
            <Network className="h-4 w-4 text-cyan-400" />
            <h2 className="text-sm font-semibold text-zinc-100">
              {mode === "create" ? "Add Network Device" : "Edit Network Device"}
            </h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="px-5 py-4 space-y-4">
          {/* Identity */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Display Name *" hint="Human-readable alias (e.g. prod-sw-jkt-01)">
              <input
                type="text"
                value={form.displayName}
                onChange={(e) => upd("displayName", e.target.value)}
                className={inputCls}
                required
              />
            </Field>
            <Field label="Hostname *" hint="Device-reported hostname (or IP)">
              <input
                type="text"
                value={form.hostname}
                onChange={(e) => upd("hostname", e.target.value)}
                className={inputCls}
                required
              />
            </Field>
          </div>

          {/* Vendor / Model / Firmware */}
          <div className="grid grid-cols-3 gap-3">
            <Field label="Vendor *">
              <select value={form.vendor} onChange={(e) => upd("vendor", e.target.value)} className={inputCls}>
                {VENDORS.map((v) => (
                  <option key={v.value} value={v.value}>{v.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Model" hint="e.g. Catalyst 2960-X">
              <input
                type="text"
                value={form.model}
                onChange={(e) => upd("model", e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Firmware" hint="e.g. 15.7(3)M2">
              <input
                type="text"
                value={form.firmware}
                onChange={(e) => upd("firmware", e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>

          {/* Mgmt IP + syslog port */}
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <Field label="Mgmt IP" hint="For anti-spoof cross-check (must match UDP source)">
              <input
                type="text"
                value={form.mgmtIp}
                onChange={(e) => upd("mgmtIp", e.target.value)}
                placeholder="10.0.0.1"
                className={`${inputCls} font-mono`}
              />
            </Field>
            <Field label="Syslog Port">
              <input
                type="number"
                value={form.syslogPort}
                onChange={(e) => upd("syslogPort", parseInt(e.target.value, 10) || 514)}
                className={`${inputCls} font-mono`}
                min={1}
                max={65535}
              />
            </Field>
          </div>

          {/* Env / Location / Role */}
          <div className="grid grid-cols-3 gap-3">
            <Field label="Environment">
              <select value={form.environment} onChange={(e) => upd("environment", e.target.value)} className={inputCls}>
                {ENVIRONMENTS.map((e) => (
                  <option key={e.value} value={e.value}>{e.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Location" hint="jkt / sg / aws-ap-southeast">
              <input
                type="text"
                value={form.location}
                onChange={(e) => upd("location", e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Role" hint="core / access / edge / firewall">
              <input
                type="text"
                value={form.role}
                onChange={(e) => upd("role", e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>

          {/* Description */}
          <Field label="Description">
            <textarea
              value={form.description}
              onChange={(e) => upd("description", e.target.value)}
              className={`${inputCls} min-h-[60px] resize-y`}
              rows={2}
            />
          </Field>

          {/* SSH toggle */}
          <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={form.sshEnabled}
              onChange={(e) => upd("sshEnabled", e.target.checked)}
              className="rounded border-zinc-700 bg-zinc-900 text-cyan-500 focus:ring-cyan-500/40"
            />
            SSH enabled (future: config backup polling)
          </label>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30 text-xs font-medium hover:bg-[var(--accent)]/25 transition-colors disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
              {mode === "create" ? "Add Device" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputCls =
  "w-full px-2.5 py-1.5 rounded bg-zinc-900 border border-zinc-800 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/50 transition-colors";

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
      <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-medium mb-1">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[10px] text-zinc-600">{hint}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Delete confirmation modal
// ─────────────────────────────────────────────────────────────────────
export function DeleteDeviceModal({
  device,
  onClose,
  onDeleted,
}: {
  device: { id: string; displayName: string };
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const orig = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = orig;
    };
  }, []);

  const onConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/assets/${device.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete");
      onDeleted();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-zinc-950 shadow-2xl">
        <div className="px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="h-8 w-8 rounded-full bg-red-500/20 flex items-center justify-center">
              <X className="h-4 w-4 text-red-400" />
            </div>
            <h2 className="text-sm font-semibold text-zinc-100">Delete device?</h2>
          </div>
          <p className="text-xs text-zinc-400 mb-3">
            You're about to delete <span className="font-mono text-zinc-200">{device.displayName}</span>.
            Historical events linked to this device will keep their reference but the asset
            link will be cleared.
          </p>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-300 mb-3">
            Type the device name <span className="font-mono font-semibold">{device.displayName}</span> below to confirm:
          </div>
          <input
            type="text"
            placeholder="Type device name to confirm"
            className={inputCls}
            id="delete-confirm"
            onChange={(e) => {
              const btn = document.getElementById("delete-confirm-btn") as HTMLButtonElement;
              if (btn) btn.disabled = e.target.value !== device.displayName;
            }}
          />
          {error && (
            <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border)] bg-zinc-900/40">
          <button onClick={onClose} className="px-3 py-1.5 rounded text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors">
            Cancel
          </button>
          <button
            id="delete-confirm-btn"
            onClick={onConfirm}
            disabled={true}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-red-500/15 text-red-400 border border-red-500/30 text-xs font-medium hover:bg-red-500/25 transition-colors disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
