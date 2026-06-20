"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Mode = "all" | "olderThan" | "bySource";

const KNOWN_SOURCES = [
  "/var/log/auth.log",
  "/var/log/secure",
  "/var/log/syslog",
  "/var/log/nginx/access.log",
  "/var/log/nginx/error.log",
  "/var/log/kern.log",
];

export function DeleteEventsButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showModal, setShowModal] = useState(false);
  const [mode, setMode] = useState<Mode>("olderThan");
  const [days, setDays] = useState<number>(30);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    rowsDeleted: number;
    beforeCount: number;
    afterCount: number;
  } | null>(null);

  const requiredText = "delete all events";
  const confirmValid = confirmText === requiredText;
  const sourcesValid = mode !== "bySource" || selectedSources.length > 0;
  const canDelete = confirmValid && sourcesValid && !isPending && !result;

  async function handleDelete() {
    setError(null);
    setResult(null);
    try {
      const body: {
        mode: Mode;
        confirmText: string;
        days?: number;
        sources?: string[];
      } = { mode, confirmText };
      if (mode === "olderThan") body.days = days;
      if (mode === "bySource") body.sources = selectedSources;

      const res = await fetch("/api/events", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setResult(data);
      // Refresh server data after successful deletion
      startTransition(() => {
        router.refresh();
      });
      // Auto-close modal after 3s on success
      setTimeout(() => {
        setShowModal(false);
        setResult(null);
        setConfirmText("");
      }, 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className="px-3 py-2 text-xs rounded-lg border border-rose-700 bg-rose-950/30 text-rose-300 hover:bg-rose-900/50 hover:border-rose-500 transition-colors flex items-center gap-1.5"
        title="Delete events (admin only)"
      >
        <TrashIcon />
        Clear Events
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DangerIcon />
                <h2 className="text-base font-semibold text-zinc-100">
                  Clear Agent Events
                </h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowModal(false);
                  setError(null);
                  setResult(null);
                  setConfirmText("");
                  setSelectedSources([]);
                }}
                className="text-zinc-500 hover:text-zinc-300"
                aria-label="Close"
              >
                <CloseIcon />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* Mode selector */}
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-2">
                  Deletion mode
                </label>
                <div className="space-y-2">
                  <label className="flex items-start gap-2 cursor-pointer p-2.5 rounded-lg border border-zinc-700 bg-zinc-800/50 hover:border-zinc-600 transition-colors">
                    <input
                      type="radio"
                      name="mode"
                      value="olderThan"
                      checked={mode === "olderThan"}
                      onChange={() => setMode("olderThan")}
                      className="mt-0.5"
                    />
                    <div className="flex-1">
                      <div className="text-sm text-zinc-100">
                        Older than{" "}
                        <input
                          type="number"
                          min={1}
                          max={3650}
                          value={days}
                          onChange={(e) =>
                            setDays(parseInt(e.target.value, 10) || 30)
                          }
                          onClick={() => setMode("olderThan")}
                          disabled={mode !== "olderThan"}
                          className="inline-block w-16 mx-1 px-1.5 py-0.5 bg-zinc-900 border border-zinc-700 rounded text-xs text-zinc-100 disabled:opacity-40"
                        />{" "}
                        days
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5">
                        Recommended — keep recent data, prune older entries
                      </div>
                    </div>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer p-2.5 rounded-lg border border-zinc-700 bg-zinc-800/50 hover:border-zinc-600 transition-colors">
                    <input
                      type="radio"
                      name="mode"
                      value="bySource"
                      checked={mode === "bySource"}
                      onChange={() => setMode("bySource")}
                      className="mt-0.5"
                    />
                    <div className="flex-1">
                      <div className="text-sm text-zinc-100">
                        By log source ({selectedSources.length} selected)
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5">
                        Delete events from specific log files (e.g. noisy syslog)
                      </div>
                      {mode === "bySource" && (
                        <div className="mt-2 grid grid-cols-1 gap-1">
                          {KNOWN_SOURCES.map((src) => (
                            <label
                              key={src}
                              className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer hover:text-zinc-100"
                            >
                              <input
                                type="checkbox"
                                checked={selectedSources.includes(src)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedSources([...selectedSources, src]);
                                  } else {
                                    setSelectedSources(
                                      selectedSources.filter((s) => s !== src)
                                    );
                                  }
                                }}
                                className="rounded border-zinc-600"
                              />
                              <code className="text-[11px] font-mono">{src}</code>
                            </label>
                          ))}
                          <div className="mt-1 text-[10px] text-zinc-600">
                            Tip: select syslog to clean up kernel/dhclient noise
                          </div>
                        </div>
                      )}
                    </div>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer p-2.5 rounded-lg border border-rose-900/50 bg-rose-950/20 hover:border-rose-700 transition-colors">
                    <input
                      type="radio"
                      name="mode"
                      value="all"
                      checked={mode === "all"}
                      onChange={() => setMode("all")}
                      className="mt-0.5"
                    />
                    <div className="flex-1">
                      <div className="text-sm text-rose-200">
                        All events (nuclear)
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5">
                        ⚠️ Deletes every event — no recovery possible
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Typed confirmation */}
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Type{" "}
                  <code className="px-1.5 py-0.5 rounded bg-zinc-800 text-rose-300 font-mono text-[11px]">
                    {requiredText}
                  </code>{" "}
                  to confirm
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={requiredText}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 text-sm focus:outline-none focus:border-rose-500 font-mono"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>

              {/* Error display */}
              {error && (
                <div className="px-3 py-2 rounded-lg border border-rose-700 bg-rose-950/30 text-rose-200 text-xs">
                  {error}
                </div>
              )}

              {/* Success display */}
              {result && (
                <div className="px-3 py-2.5 rounded-lg border border-emerald-700 bg-emerald-950/30 text-emerald-200 text-xs">
                  ✓ Deleted <strong>{result.rowsDeleted}</strong> events (was{" "}
                  {result.beforeCount}, now {result.afterCount}). Refreshing
                  table...
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-zinc-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowModal(false);
                  setError(null);
                  setResult(null);
                  setConfirmText("");
                  setSelectedSources([]);
                }}
                disabled={isPending}
                className="px-3 py-2 text-xs rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={!canDelete}
                className="px-3 py-2 text-xs rounded-lg border border-rose-600 bg-rose-600 text-white hover:bg-rose-500 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {isPending ? (
                  <>
                    <SpinnerIcon /> Deleting...
                  </>
                ) : (
                  <>
                    <TrashIcon /> Delete Events
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function TrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function DangerIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-rose-400"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="animate-spin"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}