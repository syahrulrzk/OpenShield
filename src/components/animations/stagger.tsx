"use client";

import { motion, type Variants, type HTMLMotionProps } from "framer-motion";
import { type ReactNode, Children, isValidElement, cloneElement } from "react";

/**
 * Stagger container — children fade in one by one
 *
 * Usage:
 * ```tsx
 * <StaggerList staggerDelay={0.05}>
 *   {items.map(...)}
 * </StaggerList>
 * ```
 */
const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.1,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
  },
};

export function StaggerList({
  children,
  className,
  staggerDelay = 0.05,
}: {
  children: ReactNode;
  className?: string;
  staggerDelay?: number;
}) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        ...containerVariants,
        visible: {
          opacity: 1,
          transition: {
            staggerChildren: staggerDelay,
            delayChildren: 0.05,
          },
        },
      }}
      className={className}
    >
      {Children.map(children, (child, i) => {
        if (!isValidElement(child)) return child;
        // Wrap each child in a motion.div with itemVariants
        return (
          <motion.div
            key={i}
            variants={itemVariants}
            style={{ display: "contents" }}
          >
            {child}
          </motion.div>
        );
      })}
    </motion.div>
  );
}

/**
 * StaggerItem — for use inside StaggerList (when you need explicit items)
 */
export function StaggerItem({
  children,
  className,
  ...rest
}: { children: ReactNode; className?: string } & HTMLMotionProps<"div">) {
  return (
    <motion.div variants={itemVariants} className={className} {...rest}>
      {children}
    </motion.div>
  );
}

/**
 * StaggerContainer — raw container for custom child animations
 */
export function StaggerContainer({
  children,
  className,
  staggerDelay = 0.05,
}: {
  children: ReactNode;
  className?: string;
  staggerDelay?: number;
}) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        hidden: { opacity: 0 },
        visible: {
          opacity: 1,
          transition: {
            staggerChildren: staggerDelay,
            delayChildren: 0.05,
          },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
