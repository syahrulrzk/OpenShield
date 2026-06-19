"use client";

import { motion } from "framer-motion";
import { type ReactNode } from "react";
import { Inbox, Search, AlertTriangle, Database, Server, ShieldX } from "lucide-react";

/**
 * EmptyState — friendly placeholder when no data
 *
 * Usage:
 * ```tsx
 * <EmptyState
 *   icon={Inbox}
 *   title="No events yet"
 *   description="Add an asset to start monitoring"
 *   action={<button>Add asset</button>}
 * />
 * ```
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  variant = "default",
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
  variant?: "default" | "search" | "error" | "empty-db" | "empty-server" | "no-permission";
}) {
  const variantMap = {
    default: Inbox,
    search: Search,
    error: AlertTriangle,
    "empty-db": Database,
    "empty-server": Server,
    "no-permission": ShieldX,
  };
  const ResolvedIcon = variant !== "default" ? variantMap[variant] : Icon;
  const colorClass =
    variant === "error" || variant === "no-permission"
      ? "text-[var(--danger)]"
      : variant === "search"
        ? "text-[var(--info)]"
        : "text-[var(--muted-foreground)]";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col items-center justify-center text-center py-12 px-4"
    >
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.1, type: "spring", stiffness: 200, damping: 20 }}
        className={`h-12 w-12 rounded-xl bg-white/[0.04] border border-[var(--border)] flex items-center justify-center mb-4 ${colorClass}`}
      >
        <ResolvedIcon className="h-5 w-5" />
      </motion.div>
      <h3 className="text-sm font-semibold mb-1">{title}</h3>
      {description && (
        <p className="text-xs text-[var(--muted-foreground)] max-w-sm mb-4 leading-relaxed">
          {description}
        </p>
      )}
      {action && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          {action}
        </motion.div>
      )}
    </motion.div>
  );
}

/**
 * ErrorState — for failed API calls
 */
export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load this data. Please try again.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <EmptyState
      icon={AlertTriangle}
      title={title}
      description={description}
      variant="error"
      action={
        onRetry && (
          <button
            onClick={onRetry}
            className="h-8 px-4 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 text-xs font-medium"
          >
            Try again
          </button>
        )
      }
    />
  );
}
