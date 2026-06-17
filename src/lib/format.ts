/**
 * Number, time, and string formatting utilities
 * Locale-aware, zero deps
 */

/** Format number with thousand separators: 1234 → "1,234" */
export function formatNumber(n: number, locale = "id-ID"): string {
  return new Intl.NumberFormat(locale).format(n);
}

/** Format percent with 1 decimal: 0.1234 → "12.3%" */
export function formatPercent(n: number, decimals = 1, locale = "id-ID"): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

/** Format bytes: 1024 → "1.0 KB" */
export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

/** Format duration: 90 → "1m 30s", 3600 → "1h 0m" */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return `${h}h ${rm}m`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return `${d}d ${rh}h`;
}

/** Format relative time: "2h ago", "5m ago", "just now" */
export function formatRelativeTime(date: Date | string | number, locale = "id-ID"): string {
  const d = typeof date === "object" ? date : new Date(date);
  const now = Date.now();
  const diffSec = Math.floor((now - d.getTime()) / 1000);

  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;

  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}d ago`;

  const diffWeek = Math.floor(diffDay / 7);
  if (diffWeek < 4) return `${diffWeek}w ago`;

  return d.toLocaleDateString(locale, {
    day: "2-digit",
    month: "short",
    year: diffDay > 365 ? "numeric" : undefined,
  });
}

/** Format date: "16 Jun 2026, 17:30" */
export function formatDateTime(date: Date | string | number, locale = "id-ID"): string {
  const d = typeof date === "object" ? date : new Date(date);
  return d.toLocaleString(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Truncate string with ellipsis: long text → "long te..." */
export function truncate(str: string, max = 30): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "…";
}

/** Status color helper */
export function statusColor(status: string): "success" | "danger" | "warning" | "muted" {
  if (status === "SUCCESS") return "success";
  if (status === "FAILED" || status === "INVALID" || status === "DENIED") return "danger";
  if (status === "PENDING") return "warning";
  return "muted";
}
