"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Key, Copy, RefreshCw, Trash2, ExternalLink, AlertTriangle, CheckCircle2, Download, X } from "lucide-react";

export type ApiKeyResult = {
  ok: boolean;
  asset: {
    id: string;
    displayName: string;
    apiKeyPrefix: string | null;
    apiKeyLast4: string | null;
    apiKeyCreatedAt: string | Date | null;
  };
  /** Plaintext key — returned ONCE, never again */
  apiKey: string;
  webhookUrl: string;
  instructions: string;
};

type Mode = "generate" | "regenerate" | "reveal-rotate" | "delete";

export function AppApiKeyModal({
  mode,
  appId,
  appName,
  hasExistingKey,
  existingPrefix,
  existingLast4,
  onClose,
}: {
  mode: Mode;
  appId: string;
  appName: string;
  hasExistingKey: boolean;
  existingPrefix: string | null;
  existingLast4: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiKeyResult | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [copied, setCopied] = useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (hasExistingKey) body.confirm = "regenerate";
      const res = await fetch(`/api/assets/${appId}/api-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setResult(data);
      setCopied(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (confirmText !== "delete") {
      setError('Type "delete" to confirm');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/assets/${appId}/api-key`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      onClose();
      router.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const copyKey = () => {
    if (!result?.apiKey) return;
    navigator.clipboard.writeText(result.apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadEnv = () => {
    if (!result?.apiKey) return;
    const env = `# OpenShield — App: ${appName}\n# Generated: ${new Date().toISOString()}\n# Keep this file secret. Never commit to git.\n\nOPENSHIELD_API_KEY=${result.apiKey}\nOPENSHIELD_WEBHOOK_URL=${result.webhookUrl}\nOPENSHIELD_APP_ID=${appId}\n`;
    const blob = new Blob([env], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${appName.replace(/[^a-z0-9_-]/gi, "_").toLowerCase()}-openshield.env`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Render: result view (key revealed) ──────────────────────────────
  if (result) {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-white dark:bg-zinc-950 rounded-lg shadow-xl max-w-2xl w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              API Key Created
            </h2>
            <button onClick={onClose} className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded-md p-3 text-sm flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-amber-900 dark:text-amber-200">Copy this key now</div>
              <div className="text-amber-800 dark:text-amber-300 text-xs mt-0.5">
                This is the <strong>only time</strong> the plaintext key will be shown. After this, only the hash is stored.
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-zinc-500">API Key</label>
            <div className="flex gap-2 mt-1">
              <input
                readOnly
                value={result.apiKey}
                className="flex-1 px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-md bg-zinc-50 dark:bg-zinc-900 font-mono text-xs"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <button
                onClick={copyKey}
                className="px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md flex items-center gap-1.5 text-sm"
              >
                {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                onClick={downloadEnv}
                className="px-3 py-2 bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 rounded-md flex items-center gap-1.5 text-sm"
                title="Download .env file"
              >
                <Download className="h-4 w-4" />
                .env
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-zinc-500">Webhook URL</label>
            <div className="flex gap-2 mt-1">
              <input
                readOnly
                value={result.webhookUrl}
                className="flex-1 px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-md bg-zinc-50 dark:bg-zinc-900 font-mono text-xs"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <a
                href={result.webhookUrl}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-2 bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 rounded-md flex items-center gap-1.5 text-sm"
              >
                <ExternalLink className="h-4 w-4" />
                Open
              </a>
            </div>
          </div>

          <div className="bg-zinc-50 dark:bg-zinc-900 rounded-md p-3 text-xs space-y-1">
            <div className="font-semibold text-zinc-700 dark:text-zinc-300">How to use:</div>
            <pre className="text-zinc-600 dark:text-zinc-400 overflow-x-auto whitespace-pre-wrap">
{`curl -X POST ${result.webhookUrl} \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: <your-key>" \\
  -d '{
    "event_type": "user.login",
    "actor": {"email": "alice@example.com", "user_id": "u_001"},
    "message": "Alice logged in"
  }'`}
            </pre>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
            <button
              onClick={() => {
                onClose();
                router.refresh();
              }}
              className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md text-sm"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: confirm / delete view ───────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-950 rounded-lg shadow-xl max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            {mode === "delete" ? (
              <Trash2 className="h-5 w-5 text-red-500" />
            ) : (
              <Key className="h-5 w-5 text-amber-500" />
            )}
            {mode === "delete" ? "Delete API Key" : hasExistingKey ? "Regenerate API Key" : "Generate API Key"}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="text-sm text-zinc-600 dark:text-zinc-400">
          <div className="font-medium text-zinc-900 dark:text-zinc-100 mb-1">{appName}</div>
          {hasExistingKey && existingPrefix && (
            <div className="text-xs">
              Current key: <code className="font-mono bg-zinc-100 dark:bg-zinc-900 px-1 rounded">{existingPrefix}…{existingLast4}</code>
            </div>
          )}
        </div>

        {mode === "delete" ? (
          <>
            <div className="bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-800 rounded-md p-3 text-sm text-red-900 dark:text-red-200">
              Deleting the API key will cause the app to lose access immediately. All future webhook calls with the old key will be rejected (401).
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-zinc-500">
                Type <code className="text-red-500">delete</code> to confirm
              </label>
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="delete"
                className="w-full mt-1 px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-900 text-sm"
              />
            </div>
          </>
        ) : hasExistingKey ? (
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded-md p-3 text-sm text-amber-900 dark:text-amber-200">
            Regenerating will immediately invalidate the old key. Any service using the old key will start receiving 401 errors.
          </div>
        ) : null}

        {error && (
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-800 rounded-md p-3 text-sm text-red-900 dark:text-red-200">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 border border-zinc-300 dark:border-zinc-700 rounded-md text-sm">
            Cancel
          </button>
          {mode === "delete" ? (
            <button
              onClick={handleDelete}
              disabled={loading || confirmText !== "delete"}
              className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Deleting…" : "Delete API Key"}
            </button>
          ) : (
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-md text-sm flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                "Generating…"
              ) : (
                <>
                  {hasExistingKey ? <RefreshCw className="h-4 w-4" /> : <Key className="h-4 w-4" />}
                  {hasExistingKey ? "Regenerate" : "Generate"}
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
