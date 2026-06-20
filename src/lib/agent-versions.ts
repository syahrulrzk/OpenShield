/**
 * OpenShield — Agent Version Compatibility
 *
 * SHARED (client + server safe). Pure functions only — no `node:fs` or
 * `node:path` imports. The server-side heartbeat route reads agent.py via
 * `readAgentVersionFromFs()` and computes the same status using the helpers
 * here.
 *
 * Used by:
 *   - /api/agents/heartbeat (server: validate + return versionCompat)
 *   - /dashboard/agents (client: show outdated badge)
 *   - Update Agent modal (client: compute update command)
 *
 * Bump AGENT_COMPAT.min when releasing a breaking change.
 * Bump AGENT_COMPAT.latest when releasing a new agent.py.
 */

export const AGENT_COMPAT = {
  min: "1.0.0",
  latest: "1.0.0",
};

/**
 * Compare two semver strings. Returns:
 *   -1 if a < b
 *    0 if a == b
 *    1 if a > b
 *    null if either is not a valid semver.
 */
export function compareSemver(
  a: string,
  b: string,
): -1 | 0 | 1 | null {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

export function parseSemver(
  v: string,
): [number, number, number] | null {
  const m = v.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

export type VersionStatus = "up-to-date" | "outdated" | "below-min";

/**
 * Compute version status for an agent given its current version.
 * Uses AGENT_COMPAT from this module (shared constant).
 */
export function getVersionStatus(
  agentVersion: string | null | undefined,
  compat: { min: string; latest: string } = AGENT_COMPAT,
): VersionStatus {
  if (!agentVersion) return "outdated";
  const cmpLatest = compareSemver(agentVersion, compat.latest);
  const cmpMin = compareSemver(agentVersion, compat.min);
  if (cmpMin === null || cmpLatest === null) return "outdated";
  if (cmpMin < 0) return "below-min";
  if (cmpLatest < 0) return "outdated";
  return "up-to-date";
}

/**
 * Returns the single bash command to update the agent on the host.
 * Pulls latest agent.py from /api/install/raw/agent.py, replaces file, restarts service.
 */
export function buildUpdateCommand(serverUrl: string): string {
  const base = serverUrl.replace(/\/+$/, "");
  return [
    `curl -sL ${base}/api/install/raw/agent.py \\`,
    `  | sudo tee /opt/openshield-agent/agent.py > /dev/null && \\`,
    `sudo systemctl restart openshield-agent`,
  ].join("\n");
}
