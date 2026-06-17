"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Check } from "lucide-react";

export type DropdownOption = {
  value: string;
  label: string;
  shortLabel?: string;
  count?: number;
  color?: string;
  dot?: boolean;
};

function buildUrl(
  pathname: string,
  currentParams: Record<string, string | undefined>,
  overrides: Record<string, string | undefined>
): string {
  const merged: Record<string, string | undefined> = { ...currentParams, ...overrides };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v && v !== "" && v !== "all") {
      params.set(k, v);
    }
  }
  const q = params.toString();
  return q ? `${pathname}?${q}` : pathname;
}

export function FilterDropdown({
  label,
  value,
  options,
  paramName,
  currentParams = {},
  align = "left",
}: {
  label: string;
  value: string;
  options: DropdownOption[];
  paramName: string;
  currentParams?: Record<string, string | undefined>;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const current = options.find((o) => o.value === value);
  const triggerText = current?.shortLabel || current?.label || options[0]?.shortLabel || options[0]?.label || "All";
  const hasFilter = value !== "" && value !== "all";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 h-9 pl-3 pr-2.5 rounded-lg border text-sm transition-colors ${
          hasFilter || open
            ? "border-[var(--accent-border)] bg-[var(--accent-soft)]/40 text-[var(--foreground)]"
            : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--border-strong)]"
        }`}
      >
        <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--muted-foreground)]">
          {label}
        </span>
        <span className="font-medium text-[var(--foreground)] whitespace-nowrap">{triggerText}</span>
        {current?.color && (
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: current.color }}
          />
        )}
        {current?.count !== undefined && current.count > 0 && (
          <span className="text-[10px] font-mono text-[var(--muted-foreground)]">
            {current.count}
          </span>
        )}
        <svg
          className={`h-3 w-3 text-[var(--muted-foreground)] transition-transform ${
            open ? "rotate-180" : ""
          }`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
            className={`absolute z-30 mt-1.5 min-w-[180px] rounded-lg border border-[var(--border-strong)] bg-[var(--background)] shadow-2xl shadow-black/40 overflow-hidden ${
              align === "right" ? "right-0" : "left-0"
            }`}
          >
            <div className="py-1 max-h-[320px] overflow-y-auto">
              {options.map((opt) => {
                const isActive = opt.value === value;
                const href = buildUrl(pathname, currentParams, {
                  [paramName]: opt.value || undefined,
                });
                return (
                  <Link
                    key={opt.value || "empty"}
                    href={href}
                    scroll={false}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                      isActive
                        ? "bg-[var(--accent-soft)]/40 text-[var(--accent)]"
                        : "text-[var(--foreground)] hover:bg-white/[0.04]"
                    }`}
                  >
                    {opt.dot && opt.color ? (
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: opt.color }}
                      />
                    ) : (
                      <span className="w-2 shrink-0" />
                    )}
                    <span className="flex-1 truncate">{opt.label}</span>
                    {opt.count !== undefined && (
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                          isActive
                            ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                            : "bg-white/[0.04] text-[var(--muted-foreground)]"
                        }`}
                      >
                        {opt.count}
                      </span>
                    )}
                    {isActive && (
                      <Check className="h-3 w-3 text-[var(--accent)] shrink-0" />
                    )}
                  </Link>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
