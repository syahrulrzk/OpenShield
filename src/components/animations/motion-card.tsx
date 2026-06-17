"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import { forwardRef, type ReactNode } from "react";

/**
 * MotionCard — card with subtle hover lift + tap feedback
 *
 * Usage:
 * ```tsx
 * <MotionCard hoverable clickable onClick={...}>
 *   {content}
 * </MotionCard>
 * ```
 */
interface MotionCardProps extends HTMLMotionProps<"div"> {
  children: ReactNode;
  hoverable?: boolean;
  clickable?: boolean;
  className?: string;
}

export const MotionCard = forwardRef<HTMLDivElement, MotionCardProps>(
  ({ children, hoverable = true, clickable = false, className = "", ...rest }, ref) => {
    return (
      <motion.div
        ref={ref}
        whileHover={hoverable ? { y: -2, scale: 1.005 } : undefined}
        whileTap={clickable ? { scale: 0.99 } : undefined}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
        className={`
          rounded-xl border border-[var(--border)] bg-[var(--surface)]
          transition-shadow duration-200
          ${hoverable ? "hover:border-white/[0.15] hover:shadow-lg hover:shadow-black/20" : ""}
          ${clickable ? "cursor-pointer" : ""}
          ${className}
        `}
        {...rest}
      >
        {children}
      </motion.div>
    );
  }
);
MotionCard.displayName = "MotionCard";
