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
  AlertTriangle,
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
  Search,
  ArrowUpCircle, // Update Agent button icon
  ChevronRight,
  Pencil, // Edit name / environment
} from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/animations/modal";
import { copyToClipboard } from "@/lib/clipboard";
import { AGENT_COMPAT, getVersionStatus, buildUpdateCommand } from "@/lib/agent-versions";

type AgentType = "BASH" | "PYTHON";

type AgentEnv = "PROD" | "STAGING" | "UAT";

type Agent = {
  id: string;
  name: string;
  displayId: string | null; // "OP-01" — human-friendly sequential ID
  hostname: string | null;
  ip: string | null;
  type: AgentType;
  version: string;
  os: string | null;
  environment: AgentEnv;
  status: string;
  effectiveStatus: string;
  lastHeartbeat: string | null;
  lastError: string | null;
  registeredAt: string;
  eventsSent: number;
  _count: { events: number };
};

// Shared env styling — used by the Env badge in the table, the filter
// dropdown, and the Add Agent form. Keeping a single source of truth
// avoids "PROD=red in one place, PROD=blue in another".
const AGENT_ENV_META: Record<AgentEnv, { label: string; dot: string; bg: string; text: string; border: string }> = {
  PROD:    { label: "PROD",    dot: "bg-red-500",       bg: "bg-red-500/10",      text: "text-red-400",      border: "border-red-500/30" },
  STAGING: { label: "STAGING", dot: "bg-amber-400",     bg: "bg-amber-500/10",    text: "text-amber-300",    border: "border-amber-500/30" },
  UAT:     { label: "UAT",     dot: "bg-blue-500",      bg: "bg-blue-500/10",     text: "text-blue-300",     border: "border-blue-500/30" },
};

// Agent version badge — shows version + status icon (up-to-date / outdated / below-min).
// Source of truth for "what's current" is src/lib/agent-versions.ts (read from agent.py).
function AgentVersionBadge({ version }: { version: string | null | undefined }) {
  const v = version || "0.0.0";
  const status = getVersionStatus(v);
  const meta = {
    "up-to-date": { dot: "bg-emerald-500", text: "text-emerald-300", bg: "bg-emerald-500/10", border: "border-emerald-500/30", title: "Up-to-date" },
    "outdated":   { dot: "bg-amber-400",   text: "text-amber-300",   bg: "bg-amber-500/10",   border: "border-amber-500/30",   title: `Outdated (latest ${AGENT_COMPAT.latest})` },
    "below-min":  { dot: "bg-red-500",     text: "text-red-400",     bg: "bg-red-500/10",     border: "border-red-500/30",     title: `Below minimum (min ${AGENT_COMPAT.min})` },
  }[status];
  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono border ${meta.bg} ${meta.text} ${meta.border}`}
      title={meta.title}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
      v{v}
      {status !== "up-to-date" && (
        <ArrowUpCircle className="w-3 h-3 opacity-70" />
      )}
    </div>
  );
}

// ── OS detection (derived from /etc/os-release, agent reports raw string) ──
type OsFamily = "ubuntu" | "debian" | "rhel" | "centos" | "fedora" | "rocky" | "almalinux" | "arch" | "alpine" | "amazon" | "windows" | "macos" | "freebsd" | "other";

// Extract compact version (e.g. "24.04", "12", "9.4") from a raw OS string.
// Priority: major.minor(.patch) > single number. Skips tokens prefixed by
// "v" (Alpine v3.20 → 3.20) and lone single-digit numbers adjacent to
// letters. Returns null if no version-like token is found.
function extractVersion(raw: string): string | null {
  // Strip parenthetical codenames so "(bookworm)" doesn't pollute results
  const cleaned = raw.replace(/\s*\([^)]*\)\s*/g, " ");
  // Strip "LTS", "Server", "Edition" suffixes (decoration only).
  // Also strip "v" prefix before numbers (Alpine v3.20 → 3.20).
  const stripped = cleaned
    .replace(/\bLTS\b/gi, "")
    .replace(/\bServer Edition\b/gi, "")
    .replace(/\bServer\b/gi, "")
    .replace(/\bEdition\b/gi, "")
    .replace(/\bLinux\b/gi, "") // "Ubuntu 24.04.4 LTS" → "Ubuntu 24.04.4"
    .replace(/v(\d)/gi, "$1"); // "Alpine v3.20" → "Alpine 3.20"

  // Prefer X.Y or X.Y.Z pattern (skip those preceded by literal "v")
  // Lookbehind not supported in older browsers, so use capture group + check
  const majorMinor = stripped.match(/(?:^|[^v\w])(\d+\.\d+(?:\.\d+)?)/);
  if (majorMinor) return majorMinor[1].replace(/\.0$/, "");

  // Fallback: single major number (Debian 12, CentOS 7)
  // Reject lone digits after ".v" or similar — accept only if NOT followed by ".digit"
  const major = stripped.match(/(?:^|[^\w.])(\d+)(?!\.\d)/);
  if (major) return major[1];

  return null;
}

function classifyOs(raw: string | null | undefined): { family: OsFamily; label: string; version: string | null; full: string } {
  if (!raw) return { family: "other", label: "Unknown", version: null, full: "Not yet reported" };
  const s = raw.toLowerCase();
  const version = extractVersion(raw);

  let family: OsFamily = "other";
  let label = raw;
  if (s.includes("ubuntu"))   { family = "ubuntu";   label = "Ubuntu"; }
  else if (s.includes("debian"))   { family = "debian";   label = "Debian"; }
  else if (s.includes("rocky"))    { family = "rocky";    label = "Rocky"; }
  else if (s.includes("almalinux") || s.includes("alma")) { family = "almalinux"; label = "AlmaLinux"; }
  else if (s.includes("centos"))   { family = "centos";   label = "CentOS"; }
  else if (s.includes("rhel") || s.includes("red hat")) { family = "rhel"; label = "RHEL"; }
  else if (s.includes("fedora"))   { family = "fedora";   label = "Fedora"; }
  else if (s.includes("arch"))     { family = "arch";     label = "Arch"; }
  else if (s.includes("alpine"))   { family = "alpine";   label = "Alpine"; }
  else if (s.includes("amazon"))   { family = "amazon";   label = "Amazon Linux"; }
  else if (s.includes("windows"))  { family = "windows";  label = "Windows"; }
  else if (s.includes("darwin") || s.includes("macos")) { family = "macos"; label = "macOS"; }
  else if (s.includes("freebsd"))  { family = "freebsd";  label = "FreeBSD"; }

  return { family, label, version, full: raw };
}

const AGENT_OS_META: Record<OsFamily, { bg: string; text: string; border: string }> = {
  ubuntu:    { bg: "bg-orange-500/10",   text: "text-orange-300",  border: "border-orange-500/20" },
  debian:    { bg: "bg-rose-500/10",     text: "text-rose-300",    border: "border-rose-500/20" },
  rhel:      { bg: "bg-red-500/10",      text: "text-red-300",     border: "border-red-500/20" },
  centos:    { bg: "bg-yellow-500/10",   text: "text-yellow-300",  border: "border-yellow-500/20" },
  fedora:    { bg: "bg-blue-500/10",     text: "text-blue-300",    border: "border-blue-500/20" },
  rocky:     { bg: "bg-emerald-500/10",  text: "text-emerald-300", border: "border-emerald-500/20" },
  almalinux: { bg: "bg-amber-500/10",    text: "text-amber-300",   border: "border-amber-500/20" },
  arch:      { bg: "bg-cyan-500/10",     text: "text-cyan-300",    border: "border-cyan-500/20" },
  alpine:    { bg: "bg-sky-500/10",      text: "text-sky-300",     border: "border-sky-500/20" },
  amazon:    { bg: "bg-orange-600/10",   text: "text-orange-300",  border: "border-orange-600/20" },
  windows:   { bg: "bg-blue-600/10",     text: "text-blue-300",    border: "border-blue-600/20" },
  macos:     { bg: "bg-zinc-500/10",     text: "text-zinc-300",    border: "border-zinc-500/20" },
  freebsd:   { bg: "bg-red-600/10",      text: "text-red-300",     border: "border-red-600/20" },
  other:     { bg: "bg-zinc-500/10",     text: "text-zinc-400",    border: "border-zinc-500/20" },
};

function AgentOsBadge({ os }: { os: string | null }) {
  const { family, label, version, full } = classifyOs(os);
  const meta = AGENT_OS_META[family];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono border ${meta.bg} ${meta.text} ${meta.border}`}
      title={full}
    >
      <Cpu className="w-3 h-3" />
      <span className="font-semibold">{label}</span>
      {version && <span className="opacity-80">{version}</span>}
    </span>
  );
}

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
    os: "LINUX" | "WINDOWS";
  } | null>(null);
  const [rotatedCreds, setRotatedCreds] = useState<CreatedCredentials | null>(
    null
  );

  // Agents split by status — REVOKED hidden by default for clean view
  const activeAgents = agents.filter((a) => a.effectiveStatus !== "REVOKED");
  const revokedAgents = agents.filter((a) => a.effectiveStatus === "REVOKED");
  const visibleAgents = showRevoked ? agents : activeAgents;

  // ── Edit Agent ────────────────────────────────────────────────

  // ── Edit name + environment ────────────────────────────────
  // Two cosmetic fields admins frequently want to fix:
  //   - name: rename a server without SSH'ing into it (e.g. friendly
  //     alias like "db-prod-primary" instead of "ip-10-1-1-50")
  //   - environment: reclassify after promotion/demotion or when the
  //     original choice was a placeholder
  // Both go through PATCH /api/agents/[id] which writes an audit row.
  const [editTarget, setEditTarget] = useState<Agent | null>(null);
  const [editName, setEditName] = useState("");
  const [editEnv, setEditEnv] = useState<AgentEnv>("PROD");
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);

  const openEdit = (a: Agent) => {
    setEditTarget(a);
    setEditName(a.name);
    setEditEnv(a.environment);
    setEditErr(null);
  };

  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    const trimmed = editName.trim();
    if (!trimmed) {
      setEditErr("Name cannot be empty");
      return;
    }
    if (trimmed.length > 64) {
      setEditErr("Name too long (max 64 chars)");
      return;
    }
    setEditBusy(true);
    setEditErr(null);
    try {
      const r = await fetch(`/api/agents/${editTarget.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          environment: editEnv,
        }),
      });
      const data = await r.json();
      if (data.ok) {
        toast.success(
          `Agent updated: "${trimmed}" → ${editEnv}` +
            (data.unchanged ? " (no changes)" : "")
        );
        setEditTarget(null);
        load();
      } else {
        setEditErr(data.error || "Failed to update agent");
      }
    } catch (e) {
      setEditErr(String(e));
    } finally {
      setEditBusy(false);
    }
  };

  const openUpdateAgent = (a: Agent) => {
    setUpdateTarget(a);
    setUpdateCommandCopied(false);
    // Derive serverUrl from current page origin (works for dev + prod).
    if (typeof window !== "undefined") {
      setServerUrl(window.location.origin);
    }
  };

  const copyUpdateCommand = async () => {
    if (!updateTarget || !serverUrl) return;
    const cmd = buildUpdateCommand(serverUrl);
    await copyToClipboard(cmd);
    setUpdateCommandCopied(true);
    toast.success("Update command copied to clipboard");
    setTimeout(() => setUpdateCommandCopied(false), 2000);
  };

  // ── Filters ──────────────────────────────────────────────────────
  // Search matches agent name OR hostname OR ip, case-insensitive.
  // Env filter is a single-select ("all" or one of the 5 env values).
  // Filtering happens client-side: the agent list is small (<100 rows in
  // typical deployments), and a full re-fetch on every keystroke would
  // create visible latency. When the list grows past a few hundred rows,
  // switch this to debounced server-side filtering via searchParams.
  const [search, setSearch] = useState("");
  const [envFilter, setEnvFilter] = useState<AgentEnv | "ALL">("ALL");

  const filteredAgents = visibleAgents.filter((a) => {
    if (envFilter !== "ALL" && a.environment !== envFilter) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      a.name.toLowerCase().includes(q) ||
      (a.hostname?.toLowerCase().includes(q) ?? false) ||
      (a.ip?.toLowerCase().includes(q) ?? false)
    );
  });

  const ENV_OPTIONS: { value: AgentEnv | "ALL"; label: string }[] = [
    { value: "ALL",     label: "All environments" },
    { value: "PROD",    label: "PROD (Production)" },
    { value: "STAGING", label: "STAGING" },
    { value: "UAT",     label: "UAT" },
  ];

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
  const [updateTarget, setUpdateTarget] = useState<Agent | null>(null);
  const [serverUrl, setServerUrl] = useState<string>("");
  const [updateCommandCopied, setUpdateCommandCopied] = useState(false);
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
                  {/* Bash download removed 2026-06-20 (deprecated). */}
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
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/30">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {/* Search: name, hostname, or IP (case-insensitive) */}
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, hostname, or IP…"
                  className="w-full pl-8 pr-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500/50"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300"
                    title="Clear search"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Environment filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                  Env:
                </span>
                <div className="flex gap-1">
                  {ENV_OPTIONS.map((opt) => {
                    const active = envFilter === opt.value;
                    const meta =
                      opt.value === "ALL"
                        ? null
                        : AGENT_ENV_META[opt.value as AgentEnv];
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setEnvFilter(opt.value)}
                        className={`px-2 py-1 rounded-md text-[10px] font-mono font-semibold uppercase tracking-wider transition-colors flex items-center gap-1 ${
                          active
                            ? opt.value === "ALL"
                              ? "bg-zinc-700 text-zinc-100 border border-zinc-600"
                              : `${meta?.bg} ${meta?.text} border ${meta?.border}`
                            : "bg-zinc-800/50 text-zinc-500 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-700"
                        }`}
                        title={
                          opt.value === "ALL"
                            ? "Show agents from all environments"
                            : `Filter to ${opt.value} only`
                        }
                      >
                        {meta && (
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${meta.dot}`}
                          />
                        )}
                        {opt.value === "ALL" ? "ALL" : meta?.label ?? opt.value}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs text-zinc-500 whitespace-nowrap">
              <span>
                Showing{" "}
                <span className="text-zinc-300 font-medium">
                  {filteredAgents.length}
                </span>{" "}
                of{" "}
                <span className="text-zinc-300 font-medium">
                  {visibleAgents.length}
                </span>{" "}
                agents
                {(search || envFilter !== "ALL") &&
                  filteredAgents.length !== visibleAgents.length && (
                    <span className="ml-1 text-emerald-400">
                      (filtered)
                    </span>
                  )}
              </span>
              {revokedAgents.length > 0 && (
                <span className="text-zinc-600">
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
              <tr className="divide-x divide-zinc-800">
                <th className="px-4 py-2 text-center">Status</th>
                <th className="px-4 py-2 text-center">ID</th>
                <th className="px-4 py-2 text-center">Name</th>
                <th className="px-4 py-2 text-center">Version</th>
                <th className="px-4 py-2 text-center">OS</th>
                <th className="px-4 py-2 text-center">Env</th>
                <th className="px-4 py-2 text-center">Hostname</th>
                <th className="px-4 py-2 text-center">IP</th>
                <th className="px-4 py-2 text-center">Events</th>
                <th className="px-4 py-2 text-center">Last heartbeat</th>
                <th className="px-4 py-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredAgents.map((a) => {
                const isRevoked = a.effectiveStatus === "REVOKED";
                return (
                  <tr
                    key={a.id}
                    className={`border-t border-zinc-800 hover:bg-zinc-900/40 divide-x divide-zinc-800 ${
                      isRevoked ? "opacity-60" : ""
                    }`}
                  >
                    <td className="px-4 py-2.5 text-center">
                      <AgentStatusBadge status={a.effectiveStatus} />
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {a.displayId ? (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold bg-violet-500/10 text-violet-300 border border-violet-500/30"
                          title={`Sequential display ID (cuid: ${a.id})`}
                        >
                          {a.displayId}
                        </span>
                      ) : (
                        <span
                          className="text-zinc-500 font-mono text-xs"
                          title={a.id}
                        >
                          {a.id.slice(0, 10)}…
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="font-medium text-zinc-100">{a.name}</div>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <AgentVersionBadge version={a.version} />
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <AgentOsBadge os={a.os} />
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <AgentEnvBadge env={a.environment} />
                    </td>
                    <td className="px-4 py-2.5 text-center text-zinc-300 font-mono text-xs">
                      {a.hostname || <span className="text-zinc-600">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-center text-zinc-300 font-mono text-xs">
                      {a.ip || <span className="text-zinc-600">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-center text-zinc-300 font-mono">
                      {a._count.events}
                    </td>
                    <td className="px-4 py-2.5 text-center text-zinc-500 text-xs">
                      {a.lastHeartbeat
                        ? new Date(a.lastHeartbeat).toLocaleString()
                        : "Never"}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="flex gap-1 justify-center">
                        {!isRevoked && (
                          <>
                            <button
                              onClick={() => openEdit(a)}
                              className="p-1.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-violet-400"
                              title={`Edit name / environment (currently "${a.name}" / ${a.environment})`}
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => rotate(a)}
                              className="p-1.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-emerald-400"
                              title="Rotate token (issue new, old becomes invalid)"
                            >
                              <RotateCw className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => openUpdateAgent(a)}
                              className="p-1.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-cyan-400"
                              title={`Update Agent (current v${a.version}, latest v${AGENT_COMPAT.latest})`}
                            >
                              <ArrowUpCircle className="w-4 h-4" />
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
          {filteredAgents.length === 0 && visibleAgents.length > 0 && (
            <div className="p-8 text-center bg-zinc-900/20 border-t border-zinc-800">
              <Search className="w-6 h-6 text-zinc-600 mx-auto mb-2" />
              <p className="text-zinc-400 text-sm">
                No agents match your filters
              </p>
              <button
                onClick={() => {
                  setSearch("");
                  setEnvFilter("ALL");
                }}
                className="mt-2 text-xs text-emerald-400 hover:text-emerald-300"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
      )}

      {showAdd && (
        <AddAgentModal
          onClose={() => setShowAdd(false)}
          onCreated={(creds, name, type, os) => {
            setShowAdd(false);
            setCreatedCreds({ creds, name, type, os });
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
          os={createdCreds.os}
          onClose={() => setCreatedCreds(null)}
        />
      )}
      {rotatedCreds && (
        <TokenDisplayModal
          title="Token Rotated — Update Agent Config"
          warning="Old token is now invalid. Copy new token to agent's config file."
          creds={rotatedCreds}
          os="LINUX"
          onClose={() => setRotatedCreds(null)}
        />
      )}

      {editTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
                <Pencil className="w-5 h-5 text-violet-400" />
                Edit Agent
              </h2>
              <button
                onClick={() => setEditTarget(null)}
                className="p-1 rounded hover:bg-zinc-800 text-zinc-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-zinc-500 mb-4">
              <span className="font-mono text-zinc-300">{editTarget.displayId ?? editTarget.id.slice(0, 10)}</span>{" "}
              <span className="text-zinc-600">·</span>{" "}
              <span className="font-mono">{editTarget.hostname ?? "—"}</span>{" "}
              <span className="text-zinc-600">·</span>{" "}
              <span className="font-mono">{editTarget.ip ?? "—"}</span>
            </p>
            <form onSubmit={submitEdit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Name
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  maxLength={64}
                  placeholder="e.g. db-prod-primary"
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 text-sm font-mono focus:outline-none focus:border-violet-500"
                />
                <p className="text-[10px] text-zinc-600 mt-1.5">
                  Friendly alias shown in dashboard. Does not affect the agent
                  process or hostname on the host.
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Environment
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(["PROD", "STAGING", "UAT"] as AgentEnv[]).map((env) => {
                    const meta = AGENT_ENV_META[env];
                    const active = editEnv === env;
                    return (
                      <button
                        key={env}
                        type="button"
                        onClick={() => setEditEnv(env)}
                        className={`px-2 py-2 rounded-lg border text-xs font-mono font-semibold uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5 ${
                          active
                            ? `${meta.bg} ${meta.text} ${meta.border}`
                            : "bg-zinc-800 border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${active ? meta.dot : "bg-zinc-600"}`}
                        />
                        {env}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-zinc-600 mt-1.5">
                  Reclassify after server promotion/demotion. Affects
                  filtering and the env badge color across the dashboard.
                </p>
              </div>
              {editErr && (
                <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-2 py-1.5">
                  {editErr}
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditTarget(null)}
                  className="flex-1 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editBusy}
                  className="flex-1 px-3 py-2 rounded-lg bg-violet-500 hover:bg-violet-600 disabled:opacity-50 text-zinc-950 text-sm font-medium flex items-center justify-center gap-1.5"
                >
                  {editBusy ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    "Save Changes"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
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

      {/* Update Agent — show version status + copy update command */}
      {updateTarget && (
        <Modal open onClose={() => setUpdateTarget(null)} size="md">
          {(() => {
            const status = getVersionStatus(updateTarget.version);
            const statusMeta = {
              "up-to-date": { dot: "bg-emerald-500", text: "text-emerald-300", bg: "bg-emerald-500/10", border: "border-emerald-500/30", label: "Up-to-date", desc: "Agent ini sudah versi terbaru." },
              "outdated":   { dot: "bg-amber-400",   text: "text-amber-300",   bg: "bg-amber-500/10",   border: "border-amber-500/30",   label: "Outdated", desc: "Versi baru tersedia. Sebaiknya update untuk dapat fitur/perbaikan terbaru." },
              "below-min":  { dot: "bg-red-500",     text: "text-red-400",     bg: "bg-red-500/10",     border: "border-red-500/30",     label: "Below Minimum", desc: "Agent ini di bawah versi minimum yang disupport server. Beberapa fitur mungkin tidak jalan." },
            }[status];
            const updateCmd = serverUrl ? buildUpdateCommand(serverUrl) : "Loading...";
            return (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${statusMeta.bg} ${statusMeta.border} border`}>
                    <ArrowUpCircle className={`h-5 w-5 ${statusMeta.text}`} />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-zinc-100">Update Agent</h3>
                    <div className="text-xs text-zinc-500">
                      {updateTarget.displayId && (
                        <span className="text-violet-300 font-mono mr-2">{updateTarget.displayId}</span>
                      )}
                      <span className="font-mono">{updateTarget.name}</span>
                    </div>
                  </div>
                </div>

                <div className={`rounded-lg p-3 mb-4 border ${statusMeta.bg} ${statusMeta.border}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-2 h-2 rounded-full ${statusMeta.dot}`} />
                    <span className={`text-sm font-semibold ${statusMeta.text}`}>{statusMeta.label}</span>
                  </div>
                  <div className="text-xs text-zinc-400">{statusMeta.desc}</div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-zinc-900/50 rounded p-2">
                      <div className="text-zinc-500">Current</div>
                      <div className="font-mono text-zinc-200">v{updateTarget.version}</div>
                    </div>
                    <div className="bg-zinc-900/50 rounded p-2">
                      <div className="text-zinc-500">Latest</div>
                      <div className="font-mono text-emerald-300">v{AGENT_COMPAT.latest}</div>
                    </div>
                  </div>
                </div>

                {status !== "up-to-date" && (
                  <>
                    <div className="text-xs text-zinc-400 mb-2">
                      Run command ini di host <span className="font-mono text-zinc-200">{updateTarget.hostname ?? updateTarget.name}</span>:
                    </div>
                    <div className="relative">
                      <pre className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-xs font-mono text-zinc-300 overflow-x-auto whitespace-pre-wrap break-all">
                        {updateCmd}
                      </pre>
                      <button
                        onClick={copyUpdateCommand}
                        className="absolute top-2 right-2 p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                        title="Copy command"
                      >
                        {updateCommandCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <div className="text-xs text-zinc-500 mt-2">
                      Setelah update, agent restart dalam 1–2 detik dan langsung kirim versi baru di heartbeat berikutnya.
                      Dashboard badge akan update otomatis (maks 30s).
                    </div>
                  </>
                )}

                <div className="flex justify-end gap-2 mt-5">
                  <button
                    onClick={() => setUpdateTarget(null)}
                    className="px-3 py-1.5 rounded text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                  >
                    Close
                  </button>
                </div>
              </div>
            );
          })()}
        </Modal>
      )}
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

function AgentEnvBadge({ env }: { env: AgentEnv }) {
  // AGENT_ENV_META is hoisted to module scope (defined near the Agent type
  // at the top of this file) so the table row, the filter dropdown, and the
  // Add Agent form all show identical styling.
  const m = AGENT_ENV_META[env] ?? AGENT_ENV_META.PROD;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase tracking-wider ${m.bg} ${m.text} border ${m.border}`}
      title={`Deployment environment: ${m.label}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}

function AddAgentModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (
    creds: CreatedCredentials,
    name: string,
    type: AgentType,
    os: "LINUX" | "WINDOWS"
  ) => void;
}) {
  const [name, setName] = useState("");
  // 2026-06-20: Bash runtime removed (pipe_read hang). Linux+Python only.
  // OS picker hidden until Windows installer (PowerShell) ships.
  // Kept AgentOS type for backward compatibility with onCreated() signature.
  type AgentOS = "LINUX" | "WINDOWS";
  const [os] = useState<AgentOS>("LINUX");
  const [type, setType] = useState<AgentType>("PYTHON");
  type EnvType = "PROD" | "STAGING" | "UAT";
  const [environment, setEnvironment] = useState<EnvType>("PROD");

  // OS selector removed 2026-06-20 — Linux+Python only until Windows installer ships.
  // Kept as constant for type compatibility; UI selector hidden.
  const setOs = (_next: "LINUX" | "WINDOWS") => {
    // no-op: OS picker is hidden in the modal
  };
  // 2026-06-20: Description field removed from UI (low value, users confused what to write).
  // Backend still accepts it for backward compat — it's just not surfaced in this form.
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Python Requirements starts collapsed — user expands to see full distro matrix.
  // Default collapsed keeps the modal compact; the quick-glance "Min: 3.11+" stays visible.
  const [showPythonReqs, setShowPythonReqs] = useState(false);

  const ENV_META: Record<EnvType, { label: string; desc: string; dot: string; ring: string }> = {
    PROD:    { label: "Production",  desc: "Live customer-facing",   dot: "bg-red-500",      ring: "ring-red-500/40" },
    STAGING: { label: "Staging",     desc: "Pre-production mirror",   dot: "bg-amber-400",    ring: "ring-amber-400/40" },
    UAT:     { label: "UAT",         desc: "User-acceptance testing", dot: "bg-blue-500",     ring: "ring-blue-500/40" },
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/agents", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          type,
          environment,
        }),
      });
      const data = await r.json();
      if (data.ok && data.credentials) {
        onCreated(data.credentials, name, type, os);
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
          {/* OS selector removed 2026-06-20 — Linux+Python only.
              Windows installer (PowerShell) is planned but not yet available. */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Operating System
            </label>
            <div className="px-3 py-2.5 rounded-lg border border-zinc-700 bg-zinc-800/50 flex items-center gap-2.5">
              <Terminal className="w-4 h-4 text-amber-400" />
              <div className="flex-1">
                <div className="text-sm font-medium text-zinc-100">Linux</div>
                <div className="text-xs text-zinc-500">
                  Ubuntu, Debian, RHEL, Rocky, Alpine… (Windows coming soon)
                </div>
              </div>
            </div>
          </div>

          {/* Python Requirements — collapsible, default collapsed.
              Quick-glance "Min 3.11+" stays visible; user clicks to expand distro matrix. */}
          <div>
            <button
              type="button"
              onClick={() => setShowPythonReqs((v) => !v)}
              className="w-full px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10 transition-colors flex items-center gap-2.5 text-left"
              aria-expanded={showPythonReqs}
              aria-controls="python-reqs-details"
            >
              {showPythonReqs ? (
                <ChevronDown className="w-4 h-4 text-amber-400 flex-shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-amber-400 flex-shrink-0" />
              )}
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <div className="flex-1 flex items-baseline gap-2 flex-wrap">
                <span className="text-xs font-medium text-zinc-400">
                  Python Requirements
                </span>
                <span className="text-xs font-semibold text-zinc-100">
                  Min: 3.11+
                </span>
                <span className="text-[11px] text-zinc-500">
                  (3.12 recommended)
                </span>
              </div>
              <span className="text-[10px] text-emerald-400 font-medium">
                auto-install ✓
              </span>
            </button>
            {showPythonReqs && (
              <div
                id="python-reqs-details"
                className="mt-1.5 px-3 py-2.5 rounded-lg border border-zinc-800 bg-zinc-900/40 text-xs text-zinc-300 space-y-1.5"
              >
                <div className="text-zinc-400">
                  Installer will{" "}
                  <span className="text-emerald-400 font-medium">
                    auto-install
                  </span>{" "}
                  if your distro ships with older Python:
                </div>
                <ul className="text-zinc-400 space-y-0.5 ml-1">
                  <li className="flex items-center gap-1.5">
                    <span className="inline-block w-1 h-1 rounded-full bg-zinc-600" />
                    <span className="font-mono text-zinc-300">Ubuntu/Debian</span>
                    <span className="text-zinc-500">→ deadsnakes PPA</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="inline-block w-1 h-1 rounded-full bg-zinc-600" />
                    <span className="font-mono text-zinc-300">RHEL/Rocky 8+</span>
                    <span className="text-zinc-500">→ dnf module python3.12</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="inline-block w-1 h-1 rounded-full bg-zinc-600" />
                    <span className="font-mono text-zinc-300">CentOS 7</span>
                    <span className="text-zinc-500">→ SCL rh-python38</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="inline-block w-1 h-1 rounded-full bg-zinc-600" />
                    <span className="font-mono text-zinc-300">Alpine</span>
                    <span className="text-zinc-500">→ apk add python3</span>
                  </li>
                </ul>
                <div className="text-[10px] text-zinc-500 pt-1 border-t border-zinc-800/60">
                  ⚠ Python 3.10 and older are EOL — installer will refuse and
                  exit with manual instructions.
                </div>
              </div>
            )}
          </div>

          {/* Type — runtime agent. Linux is PYTHON-only (bash removed 2026-06-20). */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Agent Runtime
            </label>
            <div className="grid grid-cols-1 gap-2">
              {/* Bash agent removed 2026-06-20 (pipe_read hang).
                  Python is now the only supported runtime. */}
              {(
                [
                  {
                    value: "PYTHON" as AgentType,
                    label: "Python",
                    desc: "FIM + process monitor + log tailing",
                    Icon: Activity,
                    iconColor: "text-blue-400",
                    disabled: false,
                  },
                ]
              ).map((opt) => {
                const active = type === opt.value;
                const Icon = opt.Icon;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={opt.disabled}
                    onClick={() => setType(opt.value)}
                    className={`p-3 rounded-lg border text-left transition-colors ${
                      active
                        ? "border-emerald-500 bg-emerald-500/10"
                        : opt.disabled
                          ? "border-zinc-800 bg-zinc-900/40 opacity-40 cursor-not-allowed"
                          : "border-zinc-700 bg-zinc-800/50 hover:border-zinc-600"
                    }`}
                  >
                    <div className="font-medium text-sm text-zinc-100 flex items-center gap-2">
                      <Icon className={`w-4 h-4 ${opt.iconColor}`} />
                      {opt.label}
                    </div>
                    <div className="text-xs text-zinc-500 mt-1">
                      {opt.desc}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Environment */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Environment
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["PROD", "STAGING", "UAT"] as const).map((env) => {
                const meta = ENV_META[env];
                const active = environment === env;
                return (
                  <button
                    key={env}
                    type="button"
                    onClick={() => setEnvironment(env)}
                    className={`p-2.5 rounded-lg border text-left transition-all ${
                      active
                        ? `border-transparent bg-zinc-800 ring-2 ${meta.ring}`
                        : "border-zinc-700 bg-zinc-800/40 hover:border-zinc-600"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={`inline-block w-2 h-2 rounded-full ${meta.dot}`} />
                      <span className="font-medium text-sm text-zinc-100">
                        {meta.label}
                      </span>
                    </div>
                    <div className="text-[10px] text-zinc-500 mt-0.5 leading-tight">
                      {meta.desc}
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-zinc-600 mt-1">
              Helps group/filter agents by deployment stage. Defaults to{" "}
              <span className="font-mono">PROD</span>.
            </p>
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
  os,
  onClose,
}: {
  title: string;
  warning: string;
  creds: CreatedCredentials;
  name?: string;
  type?: AgentType;
  os?: "LINUX" | "WINDOWS";
  onClose: () => void;
}) {
  // OS-aware install command. Windows uses PowerShell (iwr | iex);
  // Linux uses curl|bash. Token embedded in URL (one-time use bearer).
  const installCmd = (() => {
    const url = `${creds.serverUrl}/api/install/${(type ?? "python").toLowerCase()}?agent_id=${creds.agentId}&token=${creds.secretToken}`;
    if (os === "WINDOWS") {
      // PowerShell: download installer to TEMP then execute as Administrator
      return `Invoke-WebRequest -Uri "${url}" -OutFile "$env:TEMP\\openshield-install.ps1"; powershell -ExecutionPolicy Bypass -File "$env:TEMP\\openshield-install.ps1"`;
    }
    // Linux / default: bash one-liner
    return `curl -sL "${url}" | sudo bash`;
  })();
  const [copiedId, setCopiedId] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);

  const copy = async (text: string, which: "id" | "token" | "url" | "cmd") => {
    const ok = await copyToClipboard(text);
    if (!ok) {
      toast.error("Copy failed — please select text manually and Ctrl+C");
      return;
    }
    if (which === "id") {
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1500);
    } else if (which === "token") {
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 1500);
    } else if (which === "url") {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 1500);
    } else {
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 1500);
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
              {name} <span className="text-zinc-500">·</span> {os} <span className="text-zinc-500">·</span> {type}
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Agent ID
            </label>
            <div className="flex gap-2">
              <code className="flex-1 px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-emerald-400 font-mono text-xs overflow-x-auto">
                {creds.agentId}
              </code>
              <button
                onClick={() => copy(creds.agentId, "id")}
                className="px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-zinc-950 rounded-lg shrink-0 transition-colors"
                title="Copy Agent ID"
              >
                {copiedId ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Secret Token (shown once)
            </label>
            <div className="flex gap-2">
              <code className="flex-1 px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-emerald-400 font-mono text-xs overflow-x-auto break-all">
                {creds.secretToken}
              </code>
              <button
                onClick={() => copy(creds.secretToken, "token")}
                className="px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-zinc-950 rounded-lg shrink-0 transition-colors"
                title="Copy Secret Token"
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
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Server URL
            </label>
            <div className="flex gap-2">
              <code className="flex-1 px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-emerald-400 font-mono text-xs overflow-x-auto">
                {creds.serverUrl}
              </code>
              <button
                onClick={() => copy(creds.serverUrl, "url")}
                className="px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-zinc-950 rounded-lg shrink-0 transition-colors"
                title="Copy Server URL"
              >
                {copiedUrl ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Config file template
            </label>
            <pre className="px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-300 font-mono text-xs overflow-x-auto">
              {configJson}
            </pre>
            <p className="text-xs text-zinc-600 mt-1.5">
              Save as{" "}
              <span className="font-mono">
                {os === "WINDOWS"
                  ? "C:\\ProgramData\\OpenShield\\agent.json"
                  : "/etc/openshield/agent.json"}
              </span>{" "}
              on the monitored host.
            </p>
          </div>

          {type && os && (
            <div className="mt-2 p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg">
              <div className="font-medium text-emerald-300 mb-2 flex items-center gap-2 text-xs">
                <Terminal className="w-3.5 h-3.5" />
                Quick Install — One Command (run on monitored host as admin)
              </div>
              <div className="flex gap-2">
                <code className="flex-1 px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-emerald-400 font-mono text-[11px] overflow-x-auto whitespace-pre">
                  {installCmd}
                </code>
                <button
                  onClick={() => copy(installCmd, "cmd")}
                  className="px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-zinc-950 rounded-lg shrink-0 transition-colors"
                  title="Copy one-command install"
                >
                  {copiedCmd ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
              <p className="text-[10px] text-zinc-500 mt-2.5 leading-relaxed">
                {os === "WINDOWS" ? (
                  <>
                    Downloads installer, registers{" "}
                    <span className="font-mono">OpenShieldAgent</span> as a
                    Windows Service, and starts it. Requires PowerShell
                    admin. Token embedded in URL (one-time use) — no manual
                    config copy needed.
                  </>
                ) : (
                  <>
                    Auto-detects hostname/IP/OS, writes{" "}
                    <span className="font-mono">/etc/openshield/agent.json</span>,
                    installs systemd service, starts agent. Token embedded in URL
                    (one-time use) — tidak perlu copy file manual.
                  </>
                )}
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-2 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium text-sm border border-zinc-700 transition-colors"
            title="Agent sudah dibuat di DB, lo bisa install nanti lewat menu Agents"
          >
            Cancel
          </button>
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-zinc-950 font-medium text-sm transition-colors"
          >
            I've saved the credentials — close
          </button>
        </div>
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
