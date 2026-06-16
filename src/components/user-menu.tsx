"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LogOut, Settings, User, ChevronDown, Activity } from "lucide-react";

export function UserMenu({ user }: { user: { email: string; role: string } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const initials = user.email.slice(0, 2).toUpperCase();
  const canAccessSettings = user.role === "OWNER" || user.role === "ADMIN";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 h-9 px-2 rounded-lg border border-[var(--border)] bg-[var(--background)] hover:bg-white/[0.04] transition-colors"
      >
        <div className="h-7 w-7 rounded-full bg-white text-black text-xs font-bold flex items-center justify-center">
          {initials}
        </div>
        <div className="hidden sm:block text-left">
          <div className="text-xs font-medium leading-tight">{user.email.split("@")[0]}</div>
          <div className="text-[10px] text-[var(--muted-foreground)] leading-tight font-mono uppercase tracking-wider">
            {user.role}
          </div>
        </div>
        <ChevronDown
          className={`h-3.5 w-3.5 text-[var(--muted-foreground)] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] shadow-2xl z-50 overflow-hidden animate-fade-in">
          <div className="px-4 py-3 border-b border-[var(--border)]">
            <div className="text-xs font-medium truncate">{user.email}</div>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/[0.06] border border-[var(--border)]">
                {user.role}
              </span>
              <span className="text-[10px] text-[var(--muted-foreground)] flex items-center gap-1">
                <Activity className="h-2.5 w-2.5" />
                online
              </span>
            </div>
          </div>

          <div className="py-1">
            <Link
              href="/dashboard"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-white/[0.04] transition-colors"
            >
              <User className="h-4 w-4 text-[var(--muted-foreground)]" />
              Profile
            </Link>
            {canAccessSettings && (
              <Link
                href="/dashboard/settings"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-white/[0.04] transition-colors"
              >
                <Settings className="h-4 w-4 text-[var(--muted-foreground)]" />
                Settings
              </Link>
            )}
          </div>

          <div className="border-t border-[var(--border)] p-1">
            <button
              onClick={logout}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[var(--danger)] hover:bg-[var(--danger)]/10 rounded-md transition-colors"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
