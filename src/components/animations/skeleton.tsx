"use client";

import { motion } from "framer-motion";
import { type ReactNode } from "react";

/**
 * Skeleton — animated loading placeholder with shimmer
 *
 * Usage:
 * ```tsx
 * <Skeleton className="h-4 w-32" />
 * <Skeleton className="h-32 w-full rounded-xl" />
 * ```
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`relative overflow-hidden bg-white/[0.04] rounded ${className}`}
    >
      <motion.div
        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.06] to-transparent"
        animate={{ x: ["-100%", "100%"] }}
        transition={{
          duration: 1.5,
          repeat: Infinity,
          ease: "linear",
        }}
        style={{ width: "50%" }}
      />
    </div>
  );
}

/** SkeletonText — pre-styled text placeholder */
export function SkeletonText({ lines = 1, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={`h-3 ${i === lines - 1 ? "w-2/3" : "w-full"}`}
        />
      ))}
    </div>
  );
}

/** SkeletonCard — pre-styled card placeholder */
export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 ${className}`}>
      <div className="flex items-start justify-between mb-3">
        <Skeleton className="h-9 w-9 rounded-lg" />
        <Skeleton className="h-3 w-12" />
      </div>
      <Skeleton className="h-7 w-20 mb-2" />
      <Skeleton className="h-3 w-32" />
    </div>
  );
}
