"use client";

import { motion } from "framer-motion";
import { type ReactNode } from "react";

/**
 * AnimatedToggle — smooth on/off switch with spring animation
 *
 * Usage:
 * ```tsx
 * <AnimatedToggle checked={true} onChange={...} label="Enable X" />
 * ```
 */
export function AnimatedToggle({
  checked,
  onChange,
  disabled = false,
  size = "md",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const dims = {
    sm: { w: "w-8", h: "h-4", dot: "h-3 w-3", translate: 16 },
    md: { w: "w-11", h: "h-6", dot: "h-4 w-4", translate: 22 },
    lg: { w: "w-14", h: "h-7", dot: "h-5 w-5", translate: 28 },
  }[size];

  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`
        relative inline-flex shrink-0 cursor-pointer rounded-full
        transition-colors duration-200 ease-in-out
        ${dims.w} ${dims.h}
        ${checked ? "bg-[var(--success)]" : "bg-white/[0.1]"}
        ${disabled ? "opacity-50 cursor-not-allowed" : ""}
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]
      `}
      role="switch"
      aria-checked={checked}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 700, damping: 30 }}
        className={`
          pointer-events-none inline-block rounded-full bg-white shadow-lg
          ring-0
          ${dims.dot}
          ${checked ? "ml-auto mr-1" : "ml-1 mr-auto"}
        `}
        style={{ marginTop: "auto", marginBottom: "auto" }}
      />
    </button>
  );
}

/**
 * Pressable — wrapper for any clickable element with tap feedback
 */
export function Pressable({
  children,
  onClick,
  className = "",
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileHover={!disabled ? { scale: 1.02 } : undefined}
      whileTap={!disabled ? { scale: 0.98 } : undefined}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className={className}
    >
      {children}
    </motion.button>
  );
}
