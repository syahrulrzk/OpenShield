/**
 * Shared query parsing helpers for event search.
 *
 * Used by both the Server page (initial SSR data) and the API route
 * (subsequent client-side fetches via /api/events/server). Keeping these
 * in one place ensures consistent parsing across both paths.
 */

import { startOfDay, endOfDay, parse, subDays } from "date-fns";

/**
 * Parse `q` for date hints and return a day range if matched.
 *
 * Supported date formats:
 *   - "today" / "yesterday"           → relative day
 *   - "2026-06-19" / "2026/06/19"    → ISO date
 *   - "19/06/2026" / "19-06-2026"    → id-ID date (dd/MM/yyyy)
 */
export function parseDateFromQuery(q: string): { gte: Date; lte: Date } | null {
  const lower = q.toLowerCase().trim();
  const today = new Date();
  if (lower === "today") {
    return { gte: startOfDay(today), lte: endOfDay(today) };
  }
  if (lower === "yesterday") {
    const y = subDays(today, 1);
    return { gte: startOfDay(y), lte: endOfDay(y) };
  }
  const iso = q.match(/\b(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\b/);
  if (iso) {
    const d = new Date(
      `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`,
    );
    if (!isNaN(d.getTime())) return { gte: startOfDay(d), lte: endOfDay(d) };
  }
  const dmy = q.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
  if (dmy) {
    try {
      const d = parse(
        `${dmy[1]}/${dmy[2]}/${dmy[3]}`,
        "dd/MM/yyyy",
        new Date(),
      );
      if (!isNaN(d.getTime())) return { gte: startOfDay(d), lte: endOfDay(d) };
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * Extract an IPv4 address from a query string. Returns null if no IP-shaped
 * token found, or if the octets are out of range (0-255).
 */
export function parseIpFromQuery(q: string): string | null {
  const m = q.match(/\b((?:\d{1,3}\.){3}\d{1,3})\b/);
  if (!m) return null;
  const candidate = m[1];
  if (/^\d+\.\d+\.\d+\.\d+$/.test(candidate)) {
    const parts = candidate.split(".").map(Number);
    if (parts.every((p) => p >= 0 && p <= 255)) return candidate;
  }
  return null;
}
