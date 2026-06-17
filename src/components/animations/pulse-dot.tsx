"use client";

import { motion } from "framer-motion";

/**
 * PulseDot — animated dot for live indicators, anomalies
 *
 * Usage:
 * ```tsx
 * <PulseDot color="success" />     // green pulse
 * <PulseDot color="danger" ping /> // red pulse with ping ring
 * ```
 */
export function PulseDot({
  color = "success",
  ping = true,
  size = "md",
}: {
  color?: "success" | "danger" | "warning" | "info";
  ping?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const colorClass = {
    success: "bg-[var(--success)]",
    danger: "bg-[var(--danger)]",
    warning: "bg-[var(--warning)]",
    info: "bg-[var(--info)]",
  }[color];

  const sizeClass = {
    sm: "h-1.5 w-1.5",
    md: "h-2 w-2",
    lg: "h-2.5 w-2.5",
  }[size];

  return (
    <span className={`relative flex ${sizeClass}`}>
      {ping && (
        <motion.span
          className={`absolute inline-flex h-full w-full rounded-full ${colorClass} opacity-75`}
          animate={{ scale: [1, 2.5], opacity: [0.75, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
        />
      )}
      <motion.span
        className={`relative inline-flex rounded-full ${sizeClass} ${colorClass}`}
        animate={{ scale: [1, 1.1, 1] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      />
    </span>
  );
}
