"use client";

import { useState } from "react";
import { X, Box, Loader2, CheckCircle2, AlertCircle, Plus } from "lucide-react";
import { toast } from "sonner";

const APP_TYPE_META: Record<string, { label: string }> = {
  web: { label: "Web App" },
  saas: { label: "SaaS" },
  internal: { label: "Internal" },
  api: { label: "API" },
  mobile: { label: "Mobile" },
  cli: { label: "CLI" },
};

export function AddAppModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [hostname, setHostname] = useState("");
  const [appType, setAppType] = useState<string>("web");
  const [environment, setEnvironment] = useState<"PROD" | "STAGING" | "UAT" | "DEV" | "DR">("PROD");
  const [authMethod, setAuthMethod] = useState("");
  const [ownerTeam, setOwnerTeam] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);

    if (!displayName.trim()) {
      setErr("Display name is required");
      return;
    }
    if (!hostname.trim()) {
      setErr("Hostname is required");
      return;
    }

    setBusy(true);
    try {
      const body = {
        displayName: displayName.trim(),
        hostname: hostname.trim(),
        category: "APP",
        appType,
        environment,
        authMethod: authMethod.trim() || undefined,
        ownerTeam: ownerTeam.trim() || undefined,
        webhookUrl: webhookUrl.trim() || undefined,
        location: location.trim() || undefined,
        description: description.trim() || undefined,
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
        `App "${data.asset.displayName}" added.`
      );
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      toast.error(`Failed to add app: ${e instanceof Error ? e.message : String(e)}`);
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
            <Box className="h-4 w-4 text-violet-500" />
            <h2 className="text-base font-semibold">Add Application</h2>
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
          {/* Display name + Hostname */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Display name *" hint="e.g. prod-web-app-01">
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={64}
                placeholder="prod-web-app-01"
                disabled={busy}
                className="modal-input"
              />
            </Field>
            <Field label="Hostname *" hint="e.g. app.example.com">
              <input
                type="text"
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                placeholder="app.example.com"
                disabled={busy}
                className="modal-input"
              />
            </Field>
          </div>

          {/* App type + Environment */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="App type *">
              <select
                value={appType}
                onChange={(e) => setAppType(e.target.value)}
                disabled={busy}
                className="modal-input"
              >
                {Object.entries(APP_TYPE_META).map(([key, meta]) => (
                  <option key={key} value={key}>{meta.label}</option>
                ))}
              </select>
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
                <option value="DEV">Dev</option>
                <option value="DR">DR</option>
              </select>
            </Field>
          </div>

          {/* Optional fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Auth method" hint="e.g. OAuth2, JWT, Session">
              <input
                type="text"
                value={authMethod}
                onChange={(e) => setAuthMethod(e.target.value)}
                placeholder="OAuth2"
                disabled={busy}
                className="modal-input"
              />
            </Field>
            <Field label="Owner team" hint="e.g. engineering, ops">
              <input
                type="text"
                value={ownerTeam}
                onChange={(e) => setOwnerTeam(e.target.value)}
                placeholder="engineering"
                disabled={busy}
                className="modal-input"
              />
            </Field>
          </div>

          <Field label="Webhook URL" hint="URL where OpenShield sends events (optional)">
            <input
              type="text"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://app.example.com/webhook"
              disabled={busy}
              className="modal-input"
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Location" hint="jkt/sg/aws-ap-southeast/…">
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="jkt"
                disabled={busy}
                className="modal-input"
              />
            </Field>
            <Field label="Description" hint="Notes about the app">
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Our main web application"
                disabled={busy}
                className="modal-input"
              />
            </Field>
          </div>

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
              className="h-9 px-4 rounded-lg bg-violet-500 hover:bg-violet-600 text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-wait flex items-center gap-1.5"
            >
              {busy ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Saving…
                </>
              ) : (
                  <>
                    <Plus className="h-3.5 w-3.5" />
                    Add app
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
            border-color: #8b5cf6;
            box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.1);
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
