"use client";

/**
 * DatabaseHeader — Client component for /dashboard/database header
 *
 * Owns:
 *   - "Add Asset" button → opens AddAssetModal
 *   - Manual refresh button (icon-only, spins on click)
 *   - Live search input (debounced, syncs to URL ?q=)
 *   - "Back to SSH Events" link
 *
 * The page itself is a Server Component — only the interactive header
 * is client-side. Refresh triggers `router.refresh()` to re-fetch the
 * server component data without a full page reload.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Plus, RefreshCw, X, Database } from "lucide-react";
import { toast } from "sonner";
import { AddAssetModal } from "./add-asset-modal";

const DEBOUNCE_MS = 300;

export function DatabaseHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [showAdd, setShowAdd] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchValue, setSearchValue] = useState(searchParams.get("q") ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync debounced search → URL → router refresh
  useEffect(() => {
    if (searchValue === (searchParams.get("q") ?? "")) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (searchValue.trim()) {
        params.set("q", searchValue.trim());
      } else {
        params.delete("q");
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchValue]);

  // Manual refresh
  const onRefresh = () => {
    setIsRefreshing(true);
    startTransition(() => {
      router.refresh();
      // Give the server a moment to respond before clearing the spinner
      setTimeout(() => setIsRefreshing(false), 400);
    });
  };

  return (
    <>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Database Events
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Login attempts across all monitored databases
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Live search */}
          <div className="relative">
            <input
              type="text"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder="Search user, asset, db, IP…"
              className="h-9 w-56 sm:w-72 pl-3 pr-8 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-xs placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40"
            />
            {searchValue && (
              <button
                type="button"
                onClick={() => setSearchValue("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                title="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Manual refresh */}
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="h-9 w-9 rounded-lg text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-white/[0.04] flex items-center justify-center disabled:opacity-50 disabled:cursor-wait transition-colors"
            title={isRefreshing ? "Refreshing…" : "Refresh events"}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`}
            />
          </button>

          {/* Add Asset */}
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="h-9 px-3 rounded-lg bg-[var(--primary)] text-white text-xs font-semibold hover:opacity-90 transition-opacity flex items-center gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Asset
          </button>

          {/* Back to SSH Events */}
          <Link
            href="/dashboard/server"
            className="h-9 px-2.5 rounded-lg text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-white/[0.04] flex items-center gap-1.5"
          >
            <Database className="h-3.5 w-3.5" />
            SSH Events
          </Link>
        </div>
      </div>

      {showAdd && (
        <AddAssetModal
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            setShowAdd(false);
            toast.success("Asset added — first poll will run within 30s");
            startTransition(() => router.refresh());
          }}
        />
      )}
    </>
  );
}
