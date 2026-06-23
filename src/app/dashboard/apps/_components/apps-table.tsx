"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, MoreVertical, Trash2, Key, Power, PowerOff, Box } from "lucide-react";
import { AppApiKeyModal } from "./app-api-key-modal";

export type App = {
  id: string;
  displayName: string;
  hostname: string | null;
  appType: string | null;
  authMethod: string | null;
  ownerTeam: string | null;
  webhookUrl: string | null;
  environment: string | null;
  location: string | null;
  description: string | null;
  status: string;
  apiKeyPrefix: string | null;
  apiKeyLast4: string | null;
  apiKeyCreatedAt: string | null;
  apiKeyLastUsedAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  eventCount24h: number;
  warnErrorCount24h: number;
  lastEvent: {
    eventType: string;
    severity: string;
    actorEmail: string | null;
    eventTime: string;
  } | null;
};

const APP_TYPE_LABEL: Record<string, string> = {
  web: "Web",
  saas: "SaaS",
  internal: "Internal",
  api: "API",
  mobile: "Mobile",
  cli: "CLI",
};

export function AppsTable({
  apps,
  envMeta,
  typeMeta,
}: {
  apps: App[];
  envMeta: Record<string, { label: string; color: string }>;
  typeMeta: Record<string, { label: string; color: string }>;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("");
  const [filterEnv, setFilterEnv] = useState<string>("");
  const [keyModal, setKeyModal] = useState<{
    open: boolean;
    mode: "generate" | "regenerate" | "delete";
    app: App | null;
  }>({ open: false, mode: "generate", app: null });
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const filtered = apps.filter((a) => {
    if (filterType && a.appType !== filterType) return false;
    if (filterEnv && a.environment !== filterEnv) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !a.displayName.toLowerCase().includes(q) &&
        !(a.hostname?.toLowerCase().includes(q) ?? false) &&
        !(a.ownerTeam?.toLowerCase().includes(q) ?? false)
      ) {
        return false;
      }
    }
    return true;
  });

  const openKeyModal = (app: App, mode: "generate" | "regenerate" | "delete") => {
    setKeyModal({ open: true, mode, app });
  };

  const handleDelete = async (app: App) => {
    if (!confirm(`Delete app "${app.displayName}"? This will also delete all its user access events.`)) return;
    const res = await fetch(`/api/assets/${app.id}`, { method: "DELETE" });
    if (res.ok) router.refresh();
    else alert(`Delete failed: ${res.status}`);
  };

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search apps…"
            className="w-full pl-9 pr-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-950 text-sm"
          />
        </div>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-950 text-sm"
        >
          <option value="">All types</option>
          {Object.entries(APP_TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={filterEnv}
          onChange={(e) => setFilterEnv(e.target.value)}
          className="px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-950 text-sm"
        >
          <option value="">All envs</option>
          {Object.entries(envMeta).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <button
          onClick={() => router.push("/dashboard/assets")}
          className="ml-auto px-3 py-2 bg-violet-500 hover:bg-violet-600 text-white rounded-md text-sm flex items-center gap-1.5"
        >
          <Plus className="h-4 w-4" />
          New App
        </button>
      </div>

      {/* Table */}
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2">App</th>
              <th className="text-left px-4 py-2">Type</th>
              <th className="text-left px-4 py-2">Env</th>
              <th className="text-left px-4 py-2">Team</th>
              <th className="text-left px-4 py-2">API Key</th>
              <th className="text-right px-4 py-2">24h Events</th>
              <th className="text-left px-4 py-2">Last Event</th>
              <th className="text-right px-4 py-2">Status</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-12 text-zinc-500">
                  {apps.length === 0 ? (
                    <div>
                      <Box className="h-8 w-8 mx-auto mb-2 text-zinc-300" />
                      <div>No apps configured yet</div>
                      <button
                        onClick={() => router.push("/dashboard/assets")}
                        className="mt-2 text-violet-500 hover:underline text-xs"
                      >
                        Add your first app →
                      </button>
                    </div>
                  ) : (
                    "No apps match your filters"
                  )}
                </td>
              </tr>
            ) : (
              filtered.map((app) => {
                const tMeta = typeMeta[app.appType ?? "web"];
                const eMeta = app.environment ? envMeta[app.environment] : null;
                return (
                  <tr key={app.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                    <td className="px-4 py-2">
                      <div className="font-medium">{app.displayName}</div>
                      {app.hostname && (
                        <div className="text-xs text-zinc-500 font-mono">{app.hostname}</div>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {tMeta ? (
                        <span
                          className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ backgroundColor: `${tMeta.color}15`, color: tMeta.color }}
                        >
                          {tMeta.label}
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {eMeta ? (
                        <span
                          className="text-xs px-2 py-0.5 rounded font-medium"
                          style={{ color: eMeta.color }}
                        >
                          {eMeta.label}
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-zinc-600 dark:text-zinc-400">
                      {app.ownerTeam || "—"}
                    </td>
                    <td className="px-4 py-2">
                      {app.apiKeyPrefix ? (
                        <button
                          onClick={() => openKeyModal(app, "regenerate")}
                          className="flex items-center gap-1.5 text-xs font-mono text-zinc-600 dark:text-zinc-400 hover:text-amber-500"
                          title="Click to regenerate"
                        >
                          <Key className="h-3.5 w-3.5 text-amber-500" />
                          {app.apiKeyPrefix}…{app.apiKeyLast4}
                        </button>
                      ) : (
                        <button
                          onClick={() => openKeyModal(app, "generate")}
                          className="text-xs px-2 py-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded hover:bg-amber-500/20 flex items-center gap-1"
                        >
                          <Key className="h-3.5 w-3.5" />
                          Generate Key
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="font-mono text-sm">{app.eventCount24h}</div>
                      {app.warnErrorCount24h > 0 && (
                        <div className="text-xs text-amber-500">
                          ({app.warnErrorCount24h} warn/err)
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-zinc-500">
                      {app.lastEvent ? (
                        <div>
                          <div className="font-mono text-zinc-700 dark:text-zinc-300">
                            {app.lastEvent.eventType}
                          </div>
                          <div className="text-zinc-500">
                            {timeAgo(app.lastEvent.eventTime)}
                          </div>
                        </div>
                      ) : (
                        <span className="text-zinc-400">never</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          app.status === "ONLINE"
                            ? "bg-emerald-500/15 text-emerald-600"
                            : app.status === "OFFLINE"
                            ? "bg-zinc-500/15 text-zinc-500"
                            : "bg-amber-500/15 text-amber-600"
                        }`}
                      >
                        {app.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="relative">
                        <button
                          onClick={() => setMenuOpen(menuOpen === app.id ? null : app.id)}
                          className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>
                        {menuOpen === app.id && (
                          <div
                            className="absolute right-0 top-8 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-md shadow-lg z-10 py-1 min-w-[160px]"
                            onMouseLeave={() => setMenuOpen(null)}
                          >
                            <button
                              onClick={() => {
                                setMenuOpen(null);
                                openKeyModal(app, app.apiKeyPrefix ? "regenerate" : "generate");
                              }}
                              className="w-full text-left px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900 flex items-center gap-2"
                            >
                              <Key className="h-3.5 w-3.5" />
                              {app.apiKeyPrefix ? "Regenerate Key" : "Generate Key"}
                            </button>
                            {app.apiKeyPrefix && (
                              <button
                                onClick={() => {
                                  setMenuOpen(null);
                                  openKeyModal(app, "delete");
                                }}
                                className="w-full text-left px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900 flex items-center gap-2 text-red-500"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete Key
                              </button>
                            )}
                            <hr className="my-1 border-zinc-200 dark:border-zinc-800" />
                            <button
                              onClick={() => {
                                setMenuOpen(null);
                                handleDelete(app);
                              }}
                              className="w-full text-left px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900 flex items-center gap-2 text-red-500"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete App
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* API key modal */}
      {keyModal.open && keyModal.app && (
        <AppApiKeyModal
          mode={keyModal.mode}
          appId={keyModal.app.id}
          appName={keyModal.app.displayName}
          hasExistingKey={!!keyModal.app.apiKeyPrefix}
          existingPrefix={keyModal.app.apiKeyPrefix}
          existingLast4={keyModal.app.apiKeyLast4}
          onClose={() => setKeyModal({ open: false, mode: "generate", app: null })}
        />
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
