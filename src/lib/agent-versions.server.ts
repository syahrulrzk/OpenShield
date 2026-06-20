/**
 * OpenShield — Server-side agent version reader.
 *
 * Reads the VERSION constant from agents/python/agent.py on demand.
 * This module imports `node:fs` so it must NEVER be imported by client
 * components. Use `src/lib/agent-versions.ts` for client-safe helpers.
 *
 * Used by:
 *   - /api/agents/heartbeat (return versionCompat to agent)
 *   - /api/agents (enrich list with version status)
 */

import fs from "node:fs";
import path from "node:path";

const AGENT_PY_PATH = path.join(
  process.cwd(),
  "agents",
  "python",
  "agent.py",
);

let _cachedVersion: string | null = null;
let _cachedAt = 0;
const CACHE_TTL_MS = 60_000; // 1 minute — avoids re-reading on every heartbeat

/**
 * Read VERSION = "X.Y.Z" from agents/python/agent.py.
 * Falls back to "1.0.0" if file is missing or unparseable.
 * Cached for 60s to avoid file I/O on every heartbeat.
 */
export function readAgentVersionFromFs(): string {
  const now = Date.now();
  if (_cachedVersion && now - _cachedAt < CACHE_TTL_MS) {
    return _cachedVersion;
  }
  try {
    if (!fs.existsSync(AGENT_PY_PATH)) {
      _cachedVersion = "1.0.0";
      _cachedAt = now;
      return _cachedVersion;
    }
    const text = fs.readFileSync(AGENT_PY_PATH, "utf8");
    const m = text.match(/^VERSION\s*=\s*["']([^"']+)["']/m);
    _cachedVersion = m?.[1] || "1.0.0";
    _cachedAt = now;
    return _cachedVersion;
  } catch {
    _cachedVersion = "1.0.0";
    _cachedAt = now;
    return _cachedVersion;
  }
}

/**
 * Server-side AGENT_COMPAT — re-reads latest from agent.py on every call
 * (with 60s cache). Use this in API routes; the client uses the static
 * constant in `src/lib/agent-versions.ts`.
 */
export function getAgentCompat(): { min: string; latest: string } {
  return {
    min: "1.0.0",
    latest: readAgentVersionFromFs(),
  };
}
