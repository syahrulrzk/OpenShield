"use client";

import CountUp from "react-countup";
import { motion, useInView } from "framer-motion";
import { useRef } from "react";

/**
 * Animated number — counts up from 0 (or previous value) when in view
 *
 * Usage:
 * ```tsx
 * <AnimatedNumber value={440} />
 * <AnimatedNumber value={99.9} suffix="%" decimals={1} />
 * ```
 */
export function AnimatedNumber({
  value,
  decimals = 0,
  suffix = "",
  prefix = "",
  duration = 1.2,
  className,
  separator = ",",
}: {
  value: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
  duration?: number;
  className?: string;
  separator?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -50px 0px" });

  return (
    <motion.span
      ref={ref}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={inView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.3, delay: 0.1 }}
      className={className}
    >
      {inView ? (
        <CountUp
          start={0}
          end={value}
          duration={duration}
          decimals={decimals}
          separator={separator}
          suffix={suffix}
          prefix={prefix}
          preserveValue
        />
      ) : (
        <span>{prefix}0{decimals > 0 ? `.${"0".repeat(decimals)}` : ""}{suffix}</span>
      )}
    </motion.span>
  );
}
