"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Cpu,
  Plus,
  RefreshCw,
  Trash2,
  RotateCw,
  Copy,
  Check,
  X,
  Loader2,
  AlertCircle,
  Activity,
  Server,
  Terminal,
  Shield,
  Clock,
  Download,
  ChevronDown,
  Code,
  Eye,
  EyeOff,
} from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/animations/modal";

type AgentType = "BASH" | "PYTHON";

type Agent = {
  id: string;
  name: string;
  hostname: string | null;
  ip: string | null;
  type: AgentType;
  version: string;
  os: string | null;
  status: string;
  effectiveStatus: string;
  lastHeartbeat: string | null;
  lastError: string | null;
  registeredAt: string;
  eventsSent: number;
  _count: { events: number };
};

type CreatedCredentials = {
  agentId: string;
  secretToken: string;
  serverUrl: string;
  setupHint?: string;
};

export function AgentsSection() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showDownload, setShowDownload] = useState(false);
  const [showRevoked, setShowRevoked] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [createdCreds, setCreatedCreds] = useState<{
    creds: CreatedCredentials;
    name: string;
    type: AgentType;
  } | null>(null);
  const [rotatedCreds, setRotatedCreds] = useState<CreatedCredentials | null>(
    null
  );

  // Agents split by status — REVOKED hidden by default for clean view
  const activeAgents = agents.filter((a) => a.effectiveStatus !== "REVOKED");
  const revokedAgents = agents.filter((a) => a.effectiveStatus === "REVOKED");
  const visibleAgents = showRevoked ? agents : activeAgents;

  const downloadBundle = async (type: AgentType) => {
    setShowDownload(false);
    try {
      const res = await fetch(`/api/agents/download/${type.toLowerCase()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || `Download failed (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `openshield-${type.toLowerCase()}-agent.tar.gz`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${type} agent bundle`);
    } catch (e: any) {
      toast.error(`Download error: ${e.message || "unknown"}`);
    }
  };

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/agents", { credentials: "include" });
      const data = await r.json();
      if (data.ok) setAgents(data.agents);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const [revokeTarget, setRevokeTarget] = useState<Agent | null>(null);
  const [rotateTarget, setRotateTarget] = useState<Agent | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [rotating, setRotating] = useState(false);

  const performRevoke = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      const r = await fetch(`/api/agents/${revokeTarget.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (r.ok) {
        toast.success(`Agent "${revokeTarget.name}" revoked — token langsung invalid`);
        setRevokeTarget(null);
        load();
      } else {
        toast.error("Failed to revoke");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setRevoking(false);
    }
  };

  const performDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/agents/${deleteTarget.id}?hard=1`, {
        method: "DELETE",
        credentials: "include",
      });
      if (r.ok) {
        toast.success(`Agent "${deleteTarget.name}" permanently deleted`);
        setDeleteTarget(null);
        load();
      } else {
        const err = await r.json().catch(() => ({}));
        toast.error(err.error || "Failed to delete");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setDeleting(false);
    }
  };

  const performRotate = async () => {
    if (!rotateTarget) return;
    setRotating(true);
    try {
      const r = await fetch(`/api/agents/${rotateTarget.id}/rotate-token`, {
        method: "POST",
        credentials: "include",
      });
      if (r.ok) {
        const data = await r.json();
        setRevokeTarget(null);
        setRotateTarget(null);
        setRotatedCreds({
          agentId: data.agentId,
          secretToken: data.secretToken,
          serverUrl: data.serverUrl,
        });
        load();
      } else {
        toast.error("Failed to rotate");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setRotating(false);
    }
  };

  const rotate = async (a: Agent) => setRotateTarget(a);
  const revoke = async (a: Agent) => setRevokeTarget(a);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <Cpu className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-zinc-100">Agents</h3>
            <p className="text-xs text-zinc-500">
              Host-based monitoring (Bash + Python). One token per agent.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          {/* Download bundle dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowDownload((s) => !s)}
              className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-medium flex items-center gap-2 text-sm border border-zinc-700"
              title="Download agent bundle (.tar.gz)"
            >
              <Download className="w-4 h-4" />
              Download
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>
            {showDownload && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowDownload(false)}
                />
                <div className="absolute right-0 mt-1 w-56 rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl shadow-black/50 z-20 overflow-hidden">
                  <button
                    onClick={() => downloadBundle("BASH")}
                    className="w-full px-3 py-2.5 text-left text-sm hover:bg-zinc-800 flex items-center gap-2.5 text-zinc-100"
                  >
                    <Terminal className="w-4 h-4 text-emerald-400" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">Bash agent</div>
                      <div className="text-[10px] text-zinc-500 font-mono">
                        bash/ · zero-dep
                      </div>
                    </div>
                  </button>
                  <div className="border-t border-zinc-800" />
                  <button
                    onClick={() => downloadBundle("PYTHON")}
                    className="w-full px-3 py-2.5 text-left text-sm hover:bg-zinc-800 flex items-center gap-2.5 text-zinc-100"
                  >
                    <Code className="w-4 h-4 text-emerald-400" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">Python agent</div>
                      <div className="text-[10px] text-zinc-500 font-mono">
                        python/ · FIM + metrics
                      </div>
                    </div>
                  </button>
                </div>
              </>
            )}
          </div>

          <button
            onClick={() => setShowAdd(true)}
            className="px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-zinc-950 font-medium flex items-center gap-2 text-sm"
          >
            <Plus className="w-4 h-4" />
            Add Agent
          </button>
        </div>
      </div>

      {/* AGENT TABLE */}
      {loading ? (
        <div className="p-8 text-center text-zinc-500">
          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
          Loading agents…
        </div>
      ) : agents.length === 0 ? (
        <div className="p-8 text-center bg-zinc-900/40 border border-zinc-800 border-dashed rounded-xl">
          <Server className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
          <p className="text-zinc-400 text-sm">No agents yet</p>
          <p className="text-zinc-600 text-xs mt-1">
            Click "Add Agent" to create your first one.
          </p>
        </div>
      ) : visibleAgents.length === 0 ? (
        <div className="p-8 text-center bg-zinc-900/40 border border-zinc-800 border-dashed rounded-xl">
          <Server className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
          <p className="text-zinc-400 text-sm">
            {agents.length === 0
              ? "No agents yet"
              : "All agents are revoked"}
          </p>
          <p className="text-zinc-600 text-xs mt-1">
            {agents.length === 0
              ? 'Click "Add Agent" to create your first one.'
              : "Use the toggle below to show revoked agents."}
          </p>
        </div>
      ) : (
        <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl overflow-hidden">
          {/* Filter bar */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/30">
            <div className="text-xs text-zinc-500">
              Showing <span className="text-zinc-300 font-medium">{visibleAgents.length}</span> of{" "}
              <span className="text-zinc-300 font-medium">{agents.length}</span> agents
              {revokedAgents.length > 0 && (
                <span className="ml-2 text-zinc-600">
                  · {revokedAgents.length} revoked hidden
                </span>
              )}
            </div>
            {revokedAgents.length > 0 && (
              <button
                onClick={() => setShowRevoked((s) => !s)}
                className={`text-xs px-2.5 py-1 rounded-md font-medium flex items-center gap-1.5 transition-colors ${
                  showRevoked
                    ? "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                    : "bg-zinc-800/60 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                }`}
              >
                {showRevoked ? (
                  <>
                    <EyeOff className="w-3 h-3" />
                    Hide revoked
                  </>
                ) : (
                  <>
                    <Eye className="w-3 h-3" />
                    Show revoked ({revokedAgents.length})
                  </>
                )}
              </button>
            )}
          </div>

          <table className="w-full text-sm">
            <thead className="bg-zinc-900/60 text-zinc-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Type</th>
                <th className="px-4 py-2 text-left">Hostname</th>
                <th className="px-4 py-2 text-left">IP</th>
                <th className="px-4 py-2 text-right">Events</th>
                <th className="px-4 py-2 text-left">Last heartbeat</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleAgents.map((a) => {
                const isRevoked = a.effectiveStatus === "REVOKED";
                return (
                  <tr
                    key={a.id}
                    className={`border-t border-zinc-800 hover:bg-zinc-900/40 ${
                      isRevoked ? "opacity-60" : ""
                    }`}
                  >
                    <td className="px-4 py-2.5">
                      <AgentStatusBadge status={a.effectiveStatus} />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-zinc-100">{a.name}</div>
                      <div className="text-xs text-zinc-500 font-mono">
                        {a.id.slice(0, 12)}…
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono ${
                          a.type === "PYTHON"
                            ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                            : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                        }`}
                      >
                        {a.type === "PYTHON" ? (
                          <Activity className="w-3 h-3" />
                        ) : (
                          <Terminal className="w-3 h-3" />
                        )}
                        {a.type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-zinc-300 font-mono text-xs">
                      {a.hostname || <span className="text-zinc-600">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-300 font-mono text-xs">
                      {a.ip || <span className="text-zinc-600">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-300 font-mono">
                      {a._count.events}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-500 text-xs">
                      {a.lastHeartbeat
                        ? new Date(a.lastHeartbeat).toLocaleString()
                        : "Never"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex gap-1 justify-end">
                        {!isRevoked && (
                          <>
                            <button
                              onClick={() => rotate(a)}
                              className="p-1.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-emerald-400"
                              title="Rotate token (issue new, old becomes invalid)"
                            >
                              <RotateCw className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => revoke(a)}
                              className="p-1.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-red-400"
                              title="Revoke (invalidate token permanently)"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        {isRevoked && (
                          <button
                            onClick={() => setDeleteTarget(a)}
                            className="px-2 py-1 rounded text-xs font-medium bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 flex items-center gap-1"
                            title="Delete permanently from DB (irreversible)"
                          >
                            <X className="w-3 h-3" />
                            Delete Permanently
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <AddAgentModal
          onClose={() => setShowAdd(false)}
          onCreated={(creds, name, type) => {
            setShowAdd(false);
            setCreatedCreds({ creds, name, type });
            load();
          }}
        />
      )}
      {createdCreds && (
        <TokenDisplayModal
          title="Agent Created — Save Your Token"
          warning="Copy this token now. It cannot be recovered after you close this dialog."
          creds={createdCreds.creds}
          name={createdCreds.name}
          type={createdCreds.type}
          onClose={() => setCreatedCreds(null)}
        />
      )}
      {rotatedCreds && (
        <TokenDisplayModal
          title="Token Rotated — Update Agent Config"
          warning="Old token is now invalid. Copy new token to agent's config file."
          creds={rotatedCreds}
          onClose={() => setRotatedCreds(null)}
        />
      )}

      {/* Revoke confirmation */}
      <ConfirmDialog
        open={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        onConfirm={performRevoke}
        loading={revoking}
        tone="danger"
        title="Revoke Agent?"
        description={
          revokeTarget ? (
            <>
              Agent <span className="font-mono text-zinc-100">{revokeTarget.name}</span> akan
              di-revoke permanent. Agent remote akan langsung gagal authenticate dan harus
              dibuat ulang dari awal.
            </>
          ) : null
        }
        confirmLabel="Revoke Agent"
      />

      {/* Rotate confirmation */}
      <ConfirmDialog
        open={!!rotateTarget}
        onClose={() => setRotateTarget(null)}
        onConfirm={performRotate}
        loading={rotating}
        tone="warning"
        title="Rotate Token?"
        description={
          rotateTarget ? (
            <>
              Token lama untuk <span className="font-mono text-zinc-100">{rotateTarget.name}</span>{" "}
              akan langsung invalid. Agent remote harus di-update dengan token baru (config
              file), kalau tidak heartbeat-nya akan ditolak server.
            </>
          ) : null
        }
        confirmLabel="Rotate Token"
      />

      {/* Hard delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={performDelete}
        loading={deleting}
        tone="danger"
        title="Delete Permanently?"
        description={
          deleteTarget ? (
            <>
              Agent <span className="font-mono text-zinc-100">{deleteTarget.name}</span> akan
              <span className="text-red-400 font-semibold"> dihapus permanent dari database</span>{" "}
              bersama semua event-nya (<span className="font-mono">{deleteTarget._count.events}</span>).
              Snapshot tetap tersimpan di audit log untuk compliance.
            </>
          ) : null
        }
        confirmLabel="Delete Forever"
      />
    </div>
  );
}

function AgentStatusBadge({ status }: { status: string }) {
  const config: Record<
    string,
    { dot: string; bg: string; text: string; label: string }
  > = {
    ONLINE: {
      dot: "bg-emerald-400",
      bg: "bg-emerald-500/10",
      text: "text-emerald-400",
      label: "Online",
    },
    STALE: {
      dot: "bg-amber-400",
      bg: "bg-amber-500/10",
      text: "text-amber-400",
      label: "Stale",
    },
    OFFLINE: {
      dot: "bg-zinc-500",
      bg: "bg-zinc-500/10",
      text: "text-zinc-500",
      label: "Offline",
    },
    ERROR: {
      dot: "bg-red-400",
      bg: "bg-red-500/10",
      text: "text-red-400",
      label: "Error",
    },
    REGISTERED: {
      dot: "bg-blue-400",
      bg: "bg-blue-500/10",
      text: "text-blue-400",
      label: "Registered",
    },
    REVOKED: {
      dot: "bg-zinc-600",
      bg: "bg-zinc-700/30",
      text: "text-zinc-500",
      label: "Revoked",
    },
  };
  const c = config[status] || config.OFFLINE;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs ${c.bg} ${c.text}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}

function AddAgentModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (creds: CreatedCredentials, name: string, type: AgentType) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<AgentType>("BASH");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/agents", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type, description: description || undefined }),
      });
      const data = await r.json();
      if (data.ok && data.credentials) {
        onCreated(data.credentials, name, type);
      } else {
        setErr(data.error || "Failed to create agent");
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-lg p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-zinc-100">Add Agent</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Agent Name
            </label>
            <input
              type="text"
              required
              maxLength={128}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="prod-web-jkt-01"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 text-sm focus:outline-none focus:border-emerald-500"
            />
            <p className="text-xs text-zinc-600 mt-1">
              Suggestion: <span className="font-mono">prod-web-jkt-01</span>,{" "}
              <span className="font-mono">staging-db-sg-02</span>
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Type
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(["BASH", "PYTHON"] as AgentType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`p-3 rounded-lg border text-left ${
                    type === t
                      ? "border-emerald-500 bg-emerald-500/10"
                      : "border-zinc-700 bg-zinc-800/50 hover:border-zinc-600"
                  }`}
                >
                  <div className="font-medium text-sm text-zinc-100 flex items-center gap-2">
                    {t === "PYTHON" ? (
                      <Activity className="w-4 h-4 text-blue-400" />
                    ) : (
                      <Terminal className="w-4 h-4 text-amber-400" />
                    )}
                    {t}
                  </div>
                  <div className="text-xs text-zinc-500 mt-1">
                    {t === "PYTHON"
                      ? "FIM + process monitor + metrics"
                      : "Log tailing only, zero deps"}
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Description (optional)
            </label>
            <input
              type="text"
              maxLength={256}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Production web server - tier 1"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 text-sm focus:outline-none focus:border-emerald-500"
            />
          </div>
          {err && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
              <AlertCircle className="w-4 h-4" />
              {err}
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !name}
              className="flex-1 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-zinc-950 font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Shield className="w-4 h-4" />
              )}
              Create Agent
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TokenDisplayModal({
  title,
  warning,
  creds,
  name,
  type,
  onClose,
}: {
  title: string;
  warning: string;
  creds: CreatedCredentials;
  name?: string;
  type?: AgentType;
  onClose: () => void;
}) {
  const [copiedId, setCopiedId] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);

  const copy = (text: string, which: "id" | "token") => {
    navigator.clipboard.writeText(text);
    if (which === "id") {
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1500);
    } else {
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 1500);
    }
  };

  const configJson = JSON.stringify(
    {
      server_url: creds.serverUrl,
      agent_id: creds.agentId,
      secret_token: creds.secretToken,
      heartbeat_interval: 30,
      event_batch_size: 100,
    },
    null,
    2
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-emerald-500/30 rounded-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-emerald-400 flex items-center gap-2">
            <Shield className="w-5 h-5" />
            {title}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-300 text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{warning}</span>
        </div>

        {name && type && (
          <div className="mb-4 p-3 bg-zinc-800/50 border border-zinc-700 rounded-lg text-sm">
            <div className="text-zinc-500 text-xs mb-1">AGENT</div>
            <div className="font-mono text-zinc-100">
              {name} <span className="text-zinc-500">·</span> {type}
            </div>
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Agent ID
            </label>
            <div className="flex gap-1">
              <code className="flex-1 px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-emerald-400 font-mono text-xs overflow-x-auto">
                {creds.agentId}
              </code>
              <button
                onClick={() => copy(creds.agentId, "id")}
                className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-300"
                title="Copy"
              >
                {copiedId ? (
                  <Check className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Secret Token (shown once)
            </label>
            <div className="flex gap-1">
              <code className="flex-1 px-3 py-2 bg-zinc-950 border border-emerald-500/30 rounded-lg text-emerald-300 font-mono text-xs overflow-x-auto break-all">
                {creds.secretToken}
              </code>
              <button
                onClick={() => copy(creds.secretToken, "token")}
                className="px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-zinc-950 rounded-lg"
                title="Copy"
              >
                {copiedToken ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Server URL
            </label>
            <code className="block px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-300 font-mono text-xs">
              {creds.serverUrl}
            </code>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Config file template
            </label>
            <pre className="px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-300 font-mono text-xs overflow-x-auto">
              {configJson}
            </pre>
            <p className="text-xs text-zinc-600 mt-1">
              Save as{" "}
              <span className="font-mono">
                /etc/openshield/agent.json
              </span>{" "}
              on the monitored host.
            </p>
          </div>

          {type && (
            <div className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-lg">
              <div className="font-medium text-emerald-300 mb-2 flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5" />
                Quick Install — One Command (run on monitored host)
              </div>
              <div className="flex gap-1">
                <code className="flex-1 px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-emerald-400 font-mono text-[11px] overflow-x-auto whitespace-pre">
                  curl -sL &quot;{creds.serverUrl}/api/install/{type.toLowerCase()}?agent_id={creds.agentId}&token={creds.secretToken}&quot; | sudo bash
                </code>
                <button
                  onClick={() => {
                    const cmd = `curl -sL "${creds.serverUrl}/api/install/${type.toLowerCase()}?agent_id=${creds.agentId}&token=${creds.secretToken}" | sudo bash`;
                    navigator.clipboard.writeText(cmd);
                    setCopiedToken(true);
                    setTimeout(() => setCopiedToken(false), 1500);
                  }}
                  className="px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-zinc-950 rounded-lg shrink-0"
                  title="Copy one-command install"
                >
                  {copiedToken ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
              <p className="text-[10px] text-zinc-500 mt-2 leading-relaxed">
                Auto-detects hostname/IP/OS, writes{" "}
                <span className="font-mono">/etc/openshield/agent.json</span>,
                installs systemd service, starts agent. Token is embedded in URL
                (one-time use) — tidak perlu copy file manual.
              </p>
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          className="w-full mt-6 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium text-sm"
        >
          I've saved the credentials — close
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
 * ConfirmDialog — themed confirmation modal (replaces ugly native confirm())
 *
 * Tones:
 *   - danger  → red icon + red confirm button (e.g. revoke / delete)
 *   - warning → amber icon + emerald confirm (e.g. rotate token)
 *   - default → emerald icon + emerald confirm
 * ------------------------------------------------------------------ */
type ConfirmTone = "danger" | "warning" | "default";

function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  loading = false,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
}) {
  const TONE = {
    danger: {
      iconBg: "bg-red-500/10 border-red-500/20",
      iconColor: "text-red-400",
      Icon: Trash2,
      btn: "bg-red-500 hover:bg-red-600 text-white",
    },
    warning: {
      iconBg: "bg-amber-500/10 border-amber-500/20",
      iconColor: "text-amber-400",
      Icon: AlertCircle,
      btn: "bg-amber-500 hover:bg-amber-600 text-zinc-950",
    },
    default: {
      iconBg: "bg-emerald-500/10 border-emerald-500/20",
      iconColor: "text-emerald-400",
      Icon: Shield,
      btn: "bg-emerald-500 hover:bg-emerald-600 text-zinc-950",
    },
  }[tone];

  const Icon = TONE.Icon;

  return (
    <Modal open={open} onClose={onClose} size="sm">
      <div className="text-center -mt-1">
        <div
          className={`mx-auto mb-4 h-12 w-12 rounded-xl border ${TONE.iconBg} ${TONE.iconColor} flex items-center justify-center`}
        >
          <Icon className="h-5 w-5" strokeWidth={2} />
        </div>
        <h3 className="text-base font-semibold text-zinc-100">{title}</h3>
        <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
          {description}
        </p>
      </div>

      <div className="mt-6 flex gap-2">
        <button
          onClick={onClose}
          disabled={loading}
          className="flex-1 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {cancelLabel}
        </button>
        <button
          onClick={onConfirm}
          disabled={loading}
          className={`flex-1 px-4 py-2 rounded-lg font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 ${TONE.btn}`}
        >
          {loading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Working…
            </>
          ) : (
            confirmLabel
          )}
        </button>
      </div>
    </Modal>
  );
}
