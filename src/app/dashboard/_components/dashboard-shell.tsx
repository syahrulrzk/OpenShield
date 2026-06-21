"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  Cpu,
  Terminal,
  Bell,
  ShieldCheck,
  Settings,
  Menu,
  FileSpreadsheet,
  BarChart3,
  Activity,
  Database,
  AppWindow,
  Lock,
  BellRing,
  Radar,
  User,
  ScrollText,
  Eye,
  FileLock,
} from "lucide-react";
import { UserMenu } from "@/components/user-menu";
import { PulseDot } from "@/components/animations";
import { NotificationsBell } from "./notifications-bell";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";

type SubItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  locked?: boolean;
  badge?: string;
  hidden?: boolean;
};

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  requiresRole?: readonly ("OWNER" | "ADMIN")[];
  children?: SubItem[];
  locked?: boolean;
  badge?: string;
};

type NavGroup = {
  label: string;
  requiresRole?: readonly ("OWNER" | "ADMIN")[];
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "Monitoring",
    items: [
      {
        href: "/dashboard/agents",
        label: "Agent Endpoint",
        icon: Cpu,
        requiresRole: ["OWNER", "ADMIN"] as const,
      },
      {
        href: "/dashboard/events",
        label: "Event Log",
        icon: Activity,
        children: [
          { href: "/dashboard/server", label: "Server Auth", icon: Terminal },
          { href: "/dashboard/database", label: "Database", icon: Database },
          {
            href: "/dashboard/apps",
            label: "Apps",
            icon: AppWindow,
            locked: true,
            badge: "Soon",
          },
          {
            href: "/dashboard/events/syslog",
            label: "Syslog",
            icon: ScrollText,
          },
          {
            href: "/dashboard/events/auditd",
            label: "Auditd",
            icon: Eye,
            locked: true,
            badge: "Soon",
          },
          {
            href: "/dashboard/events/fim",
            label: "FIM",
            icon: FileLock,
            locked: true,
            badge: "Soon",
          },
        ],
      },
      { href: "/dashboard/alerts", label: "Alerts", icon: Bell },
      { href: "/dashboard/notifications", label: "Notifications", icon: BellRing },
    ],
  },
  {
    label: "Analytics",
    requiresRole: ["OWNER", "ADMIN"] as const,
    items: [
      {
        href: "/dashboard/reports",
        label: "Reports",
        icon: FileSpreadsheet,
      },
      { href: "/dashboard/analysis", label: "Analysis", icon: BarChart3 },
    ],
  },
  {
    label: "Admin",
    requiresRole: ["OWNER", "ADMIN"] as const,
    items: [
      { href: "/dashboard/settings", label: "Settings", icon: Settings },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/dashboard/profile", label: "Profile", icon: User },
    ],
  },
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
  const [mounted, setMounted] = useState(false);

  // Silent background JWT refresh — keeps user logged in indefinitely
  useAutoRefresh();

  useEffect(() => {
    setMounted(true);
  }, []);

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

  // Lock body scroll when open (smoother — use position:fixed trick)
  useEffect(() => {
    if (open) {
      const scrollY = window.scrollY;
      document.body.style.position = "fixed";
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = "100%";
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.position = "";
        document.body.style.top = "";
        document.body.style.width = "";
        document.body.style.overflow = "";
        window.scrollTo(0, scrollY);
      };
    }
  }, [open]);

  // Visible groups filtered by role
  const visibleGroups = navGroups
    .filter((g) => {
      const groupRole = (g as any).requiresRole as
        | readonly ("OWNER" | "ADMIN")[]
        | undefined;
      if (!groupRole) return true;
      return groupRole.includes(user.role as "OWNER" | "ADMIN");
    })
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (i) =>
          !i.requiresRole || i.requiresRole.includes(user.role as "OWNER" | "ADMIN"),
      ),
    }));

  const sidebarContent = (
    <div className="relative flex flex-col h-full bg-[var(--background)] border-r border-[var(--accent-border)] overflow-hidden">
      {/* === Login-style background: emerald grid + 2 radial glows === */}
      <div
        className="absolute inset-0 pointer-events-none opacity-60"
        aria-hidden="true"
        style={{
          backgroundImage:
            "linear-gradient(rgba(16,185,129,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(16,185,129,0.06) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute -top-32 -left-32 w-[280px] h-[280px] rounded-full bg-[var(--accent)]/[0.08] blur-[80px]" />
        <div className="absolute -bottom-32 -right-20 w-[260px] h-[260px] rounded-full bg-[var(--accent)]/[0.05] blur-[80px]" />
      </div>

      {/* (Brand header moved to topbar — logo only, no text) */}

      {/* Nav groups */}
      <nav className="relative flex-1 overflow-y-auto px-3 py-4">
        {visibleGroups.map((group, gIdx) => (
          <div key={group.label} className={gIdx > 0 ? "mt-5" : ""}>
            <div className="px-3 mb-1.5 text-[10px] font-semibold tracking-[0.15em] uppercase text-[var(--muted-foreground)] flex items-center gap-1.5">
              <Radar className="h-2.5 w-2.5 opacity-50" strokeWidth={2} />
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = (() => {
                  if (item.children) {
                    // Parent stays open when pathname matches any child OR the parent itself
                    return (
                      pathname.startsWith(item.href) ||
                      item.children.some((sub) => pathname.startsWith(sub.href))
                    );
                  }
                  return item.href === "/dashboard"
                    ? pathname === "/dashboard"
                    : pathname.startsWith(item.href);
                })();
                const Icon = item.icon;

                return (
                  <div key={item.href} className="space-y-0.5">
                    <Link
                      href={item.href}
                      className={`group relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                        isActive
                          ? "text-[var(--foreground)] font-medium"
                          : "text-[var(--muted)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      {isActive && (
                        <motion.span
                          layoutId="nav-indicator"
                          className="absolute inset-0 rounded-lg bg-[var(--accent-soft)] border border-[var(--accent-border)]"
                          transition={{ type: "spring", stiffness: 400, damping: 30 }}
                        />
                      )}
                      <Icon
                        className={`relative h-4 w-4 transition-all ${
                          isActive
                            ? "scale-110 text-[var(--accent)]"
                            : "group-hover:scale-105"
                        }`}
                        strokeWidth={isActive ? 2.25 : 1.75}
                      />
                      <span className="relative flex-1">{item.label}</span>
                      {isActive && !item.children && (
                        <motion.span
                          layoutId="nav-dot"
                          className="ml-auto h-1.5 w-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_8px_var(--accent-glow)]"
                          transition={{ type: "spring", stiffness: 500, damping: 30 }}
                        />
                      )}
                    </Link>

                    {/* Sub-menu */}
                    <AnimatePresence initial={false}>
                      {item.children && isActive && (
                        <motion.div
                          key="submenu"
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                          className="overflow-hidden"
                        >
                          <div className="ml-4 pl-3 border-l border-[var(--border)] space-y-0.5 py-1">
                            {item.children
                              .filter((sub) => !sub.hidden)
                              .map((sub) => {
                                const subActive = pathname === sub.href;
                                const SubIcon = sub.icon;
                              if (sub.locked) {
                                return (
                                  <div
                                    key={sub.href}
                                    className="group flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs text-[var(--muted-foreground)] opacity-60 cursor-not-allowed"
                                    title={`${sub.label} — coming soon`}
                                  >
                                    <Lock
                                      className="h-3 w-3 shrink-0"
                                      strokeWidth={1.75}
                                    />
                                    <span className="flex-1">{sub.label}</span>
                                    {sub.badge && (
                                      <span className="text-[9px] px-1.5 py-0.5 rounded font-mono uppercase tracking-wider bg-white/[0.04] text-[var(--muted-foreground)]">
                                        {sub.badge}
                                      </span>
                                    )}
                                  </div>
                                );
                              }
                              return (
                                <Link
                                  key={sub.href}
                                  href={sub.href}
                                  className={`group relative flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs transition-colors ${
                                    subActive
                                      ? "text-[var(--accent)] font-medium bg-[var(--accent-soft)]"
                                      : "text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-white/[0.03]"
                                  }`}
                                >
                                  <SubIcon
                                    className={`h-3 w-3 ${
                                      subActive ? "text-[var(--accent)]" : ""
                                    }`}
                                    strokeWidth={subActive ? 2.25 : 1.75}
                                  />
                                  <span className="flex-1">{sub.label}</span>
                                  {subActive && (
                                    <span className="h-1 w-1 rounded-full bg-[var(--accent)]" />
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
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="relative p-4 border-t border-[var(--border)] shrink-0">
        <div className="text-[10px] text-[var(--muted-foreground)] tracking-wider uppercase flex items-center gap-1.5">
          <span className="font-mono">v1.0.0</span>
          <span>·</span>
          <span>OWASP 2025</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col bg-[var(--background)] text-[var(--foreground)] relative">
      {/* Global dashboard background */}
      <div
        className="absolute inset-0 pointer-events-none opacity-30"
        aria-hidden="true"
        style={{
          backgroundImage:
            "linear-gradient(rgba(16,185,129,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(16,185,129,0.04) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      {/* Topbar — full width across the top, same emerald style as sidebar.
            overflow-visible so dropdowns (NotificationsBell, UserMenu) aren't clipped,
            glows clipped via clip-path on the pattern container. */}
      <header className="relative h-14 border-b border-[var(--border)] bg-[var(--background)] backdrop-blur-md sticky top-0 z-30 flex items-center justify-between px-4 sm:px-6 gap-3 shrink-0">
        {/* Emerald grid pattern (same as sidebar) */}
        <div
          className="absolute inset-0 pointer-events-none opacity-60"
          aria-hidden="true"
          style={{
            backgroundImage:
              "linear-gradient(rgba(16,185,129,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(16,185,129,0.06) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
            clipPath: "inset(0)",
          }}
        />
        {/* Radial glows (smaller scale for topbar, clipped to header bounds) */}
        <div
          className="absolute inset-0 pointer-events-none overflow-hidden"
          aria-hidden="true"
        >
          <div className="absolute -top-20 -left-20 w-[180px] h-[140px] rounded-full bg-[var(--accent)]/[0.10] blur-[60px]" />
          <div className="absolute -top-10 right-1/3 w-[200px] h-[120px] rounded-full bg-[var(--accent)]/[0.06] blur-[60px]" />
        </div>
        {/* Brand: logo only (left side) */}
        <div className="relative z-10 flex items-center gap-3 min-w-0">
          <motion.button
            type="button"
            onClick={() => setOpen(true)}
            whileTap={{ scale: 0.92 }}
            className="md:hidden h-9 w-9 -ml-1 rounded-lg hover:bg-white/[0.05] flex items-center justify-center text-[var(--muted)] hover:text-[var(--foreground)]"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </motion.button>
          <Link
            href="/dashboard"
            className="flex items-center gap-2.5"
            title="OpenShield"
          >
            {/* Logo: white + emerald accent, square aspect 219:240 (~0.91:1). */}
            <div className="relative flex items-center justify-center shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo-openshield-v2.png"
                alt="OpenShield"
                className="object-contain block"
                style={{ height: "36px", width: "36px" }}
                onError={(e) => {
                  // Fallback to icon if logo fails to load
                  e.currentTarget.style.display = "none";
                  e.currentTarget.parentElement?.classList.add("fallback");
                }}
              />
            </div>
            {/* Brand text — two-tone to match logo (Open white + Shield emerald) */}
            <div className="flex items-baseline gap-0 min-w-0">
              <span className="text-2xl font-bold tracking-tight whitespace-nowrap leading-none">
                <span className="text-white">Open</span>
                <span className="text-emerald-400">Shield</span>
              </span>
            </div>
          </Link>
        </div>

        {/* Right: status + user (no email/role chip — kept cleaner). */}
        {/* z-40 ensures dropdowns (NotificationsBell, UserMenu) sit above pattern/glow layers. */}
        <div className="relative z-40 flex items-center gap-3 shrink-0">
          {mounted && <NotificationsBell />}
          <div className="hidden sm:flex items-center gap-1.5 h-9 px-2.5 rounded-lg border border-[var(--border)] bg-white/[0.02]">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--accent)] opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
            </span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--accent)]">
              Online
            </span>
          </div>
          <UserMenu user={user} />
        </div>
      </header>

      {/* Body row: sidebar + main content */}
      <div className="flex-1 flex min-h-0 relative z-10">
      {/* Desktop sidebar (md+) — height matches viewport minus topbar */}
      <aside className="hidden md:flex md:flex-col w-60 shrink-0 sticky top-14 h-[calc(100vh-3.5rem)] relative z-20 border-r border-[var(--border)]">
        {sidebarContent}
      </aside>

      {/* Mobile sidebar — smoother slide + blur backdrop */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              onClick={() => setOpen(false)}
              className="md:hidden fixed inset-0 z-40 bg-black/70 backdrop-blur-md"
              aria-hidden="true"
            />
            <motion.aside
              key="mobile-aside"
              initial={{ x: "-105%" }}
              animate={{ x: 0 }}
              exit={{ x: "-105%" }}
              transition={{
                type: "spring",
                stiffness: 300,
                damping: 30,
                mass: 0.8,
              }}
              className="md:hidden fixed inset-y-0 left-0 z-50 w-80 max-w-[85vw] shadow-[0_0_60px_rgba(0,0,0,0.5)]"
            >
              {sidebarContent}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        <main className="flex-1 overflow-auto">
          <div className="w-full p-4 sm:p-6 lg:p-8">{children}</div>
        </main>
      </div>
      </div>
    </div>
  );
}
