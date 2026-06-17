"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  LogOut,
  Settings,
  User,
  Activity,
} from "lucide-react";

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

  const canAccessSettings = user.role === "OWNER" || user.role === "ADMIN";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 h-9 px-2 rounded-lg border border-[var(--border)] hover:border-[var(--accent-border)] hover:bg-white/[0.04] transition-colors"
        aria-label="User menu"
      >
        <div className="h-7 w-7 rounded-lg bg-[var(--accent-soft)] border border-[var(--accent-border)] text-[var(--accent)] flex items-center justify-center">
          <User className="h-4 w-4" strokeWidth={2.25} />
        </div>
        <div className="hidden sm:block text-left min-w-0">
          <div className="text-xs font-medium leading-tight truncate max-w-[120px]">
            {user.email.split("@")[0]}
          </div>
          <div className="text-[10px] text-[var(--muted-foreground)] leading-tight font-mono uppercase tracking-wider">
            {user.role}
          </div>
        </div>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 rounded-xl border border-[var(--border-strong)] bg-[var(--background)] shadow-2xl z-50 overflow-hidden animate-fade-in">
          <div className="px-4 py-3 border-b border-[var(--border)]">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-lg bg-[var(--accent-soft)] border border-[var(--accent-border)] text-[var(--accent)] flex items-center justify-center shrink-0">
                <User className="h-4 w-4" strokeWidth={2.25} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium truncate">{user.email}</div>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/[0.06] border border-[var(--border)]">
                    {user.role}
                  </span>
                  <span className="text-[10px] text-[var(--accent)] flex items-center gap-1">
                    <Activity className="h-2.5 w-2.5" />
                    online
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="py-1">
            <Link
              href="/dashboard/profile"
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
