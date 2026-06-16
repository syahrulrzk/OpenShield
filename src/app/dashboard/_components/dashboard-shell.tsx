"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Server,
  Terminal,
  Bell,
  ShieldCheck,
  Settings,
  Menu,
  FileSpreadsheet,
  BarChart3,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";

const nav = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/assets", label: "Assets", icon: Server },
  { href: "/dashboard/events", label: "SSH Events", icon: Terminal },
  { href: "/dashboard/alerts", label: "Alerts", icon: Bell },
  { href: "/dashboard/reports", label: "Reports", icon: FileSpreadsheet, requiresRole: ["OWNER", "ADMIN"] as const },
  { href: "/dashboard/analysis", label: "Analysis", icon: BarChart3, requiresRole: ["OWNER", "ADMIN"] as const },
  { href: "/dashboard/settings", label: "Settings", icon: Settings, requiresRole: ["OWNER", "ADMIN"] as const },
];

export function DashboardShell({
  user,
  children,
}: {
  user: { email: string; role: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close mobile sidebar on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const sidebarContent = (
    <div className="flex flex-col h-full bg-[var(--background)] border-r border-[var(--border)]">
      <Link
        href="/dashboard"
        className="flex items-center gap-2.5 px-5 h-16 border-b border-[var(--border)] shrink-0"
      >
        <div className="h-8 w-8 rounded-lg bg-white dark:bg-white text-black flex items-center justify-center glow">
          <ShieldCheck className="h-4.5 w-4.5" strokeWidth={2.5} />
        </div>
        <div>
          <div className="text-sm font-semibold tracking-tight">
            OpenShield
          </div>
          <div className="text-[10px] text-[var(--muted-foreground)] tracking-wide uppercase">
            Security Monitor
          </div>
        </div>
      </Link>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {nav
          .filter((item) => !item.requiresRole || item.requiresRole.includes(user.role as "OWNER" | "ADMIN"))
          .map((item) => {
            const active =
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all ${
                  active
                    ? "bg-white/[0.06] text-[var(--foreground)] font-medium"
                    : "text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-white/[0.03]"
                }`}
              >
                <item.icon
                  className={`h-4 w-4 transition-transform ${
                    active ? "scale-110" : "group-hover:scale-105"
                  }`}
                  strokeWidth={active ? 2.25 : 1.75}
                />
                {item.label}
              </Link>
            );
          })}
      </nav>

      <div className="p-4 border-t border-[var(--border)] shrink-0">
        <div className="text-[10px] text-[var(--muted-foreground)] tracking-wider uppercase">
          v0.1.0 · OWASP 2025
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-[var(--background)] text-[var(--foreground)]">
      {/* Desktop sidebar (md+) */}
      <aside className="hidden md:flex md:flex-col w-60 shrink-0 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* Mobile sidebar (overlay) */}
      {open && (
        <>
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm animate-fade-in"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <aside className="md:hidden fixed inset-y-0 left-0 z-50 w-72 animate-slide-in shadow-2xl">
            {sidebarContent}
          </aside>
        </>
      )}

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="h-16 border-b border-[var(--border)] bg-[var(--background)]/80 backdrop-blur-md sticky top-0 z-30 flex items-center justify-between px-4 sm:px-6 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="md:hidden h-9 w-9 -ml-1 rounded-lg hover:bg-white/[0.05] flex items-center justify-center text-[var(--muted)] hover:text-[var(--foreground)]"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="md:hidden flex items-center gap-2 min-w-0">
              <ShieldCheck className="h-4 w-4 text-[var(--foreground)] shrink-0" strokeWidth={2.5} />
              <span className="text-sm font-semibold tracking-tight truncate">
                OpenShield
              </span>
            </div>
            <div className="hidden md:flex items-center gap-2 text-xs text-[var(--muted-foreground)] font-mono">
              <span className="text-[var(--foreground)]">{user.email}</span>
              <span>·</span>
              <span className="px-1.5 py-0.5 rounded bg-white/[0.05] border border-[var(--border)]">
                {user.role}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <ThemeToggle />
            <UserMenu user={user} />
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
