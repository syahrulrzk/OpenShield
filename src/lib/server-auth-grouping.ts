/**
 * Session grouping for SSH events.
 *
 * One SSH connection emits 3-6 events in close succession:
 *   sshd.connection → sshd.accepted/failed → sshd.{shell,sftp,scp}_session
 *   → sshd.command_session (multiple times for long sessions)
 *
 * Showing all of them in the UI is noisy — a single `ssh user@host` becomes
 * 3-6 rows. We group by (sourceIp, sourcePort) which is the TCP connection
 * 4-tuple key (same port = same TCP connection = same SSH session).
 *
 * For each group we keep the highest-priority event as the primary row
 * (accepted/failed > sftp/scp/shell_session > command_session > connection)
 * and summarise the other events in `sessionSubsessions`.
 *
 * Why port-based and not session-id?
 *   - The agent doesn't track SSH session IDs across events (would require
 *     stateful parser correlating `pam_unix(sshd:session)` lifecycle)
 *   - The OS recycles ephemeral ports quickly enough (5min window) that
 *     port-collision across real sessions is rare
 *   - For the rare case (port reused within 5min from same IP) the user
 *     sees a merged session — acceptable trade-off
 */

export type RawServerAuthRow = {
  id: string;
  eventTime: Date;
  username: string;
  sourceIp: string;
  sourcePort: number | null;
  sourceFile: string | null;
  service: string | null;
  method: string | null;
  status: string;
  count: number;
  raw: string | null;
  /** Optional — Prisma queries can select agentId explicitly, but for
   *  the grouping logic we only need eventTime + sourceIp + sourcePort + raw. */
  agentId?: string;
  agent?: { name: string; hostname: string | null; ip: string | null; revokedAt?: Date | null } | null;
};

export type GroupedServerAuthRow = RawServerAuthRow & {
  /** Names of additional events in the same session (e.g. ["sftp_session", "command_session"]) */
  sessionSubsessions: string[];
  /** Total events in the session (1 = no subsessions, primary is the only event) */
  sessionEventCount: number;
};

// Priority: highest = most informative. Keep this event as the primary row
// of the session group; lower-priority events become subsessions.
const EVENT_PRIORITY: Record<string, number> = {
  sshd_accepted: 100,
  sshd_failed: 95,
  sshd_sftp_session: 80,
  sshd_scp_session: 80,
  sshd_shell_session: 80,
  sshd_command_session: 60,
  sshd_connection: 40,
};

function eventKeyFromRaw(raw: string | null | undefined): string {
  if (!raw) return "unknown";
  // Raw format: "... | sig=user|ip|/var/log/auth.log|INFO|sshd.accepted"
  // The event type is the last |section.
  const m = raw.match(/\|(sshd\.[a-z_]+)\s*$/);
  if (m) return m[1].replace(".", "_");
  // Fallback: try to find any sshd. prefix anywhere
  const m2 = raw.match(/sshd\.([a-z_]+)/);
  if (m2) return `sshd_${m2[1]}`;
  return "unknown";
}

export function groupBySession(rows: RawServerAuthRow[]): GroupedServerAuthRow[] {
  const groups = new Map<string, RawServerAuthRow[]>();
  for (const r of rows) {
    const key = `${r.sourceIp}::${r.sourcePort ?? "null"}`;
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }
  const out: GroupedServerAuthRow[] = [];
  for (const [, groupRows] of groups) {
    // Sort: highest priority first; ties broken by earliest eventTime
    groupRows.sort((a, b) => {
      const ap = EVENT_PRIORITY[eventKeyFromRaw(a.raw)] ?? 0;
      const bp = EVENT_PRIORITY[eventKeyFromRaw(b.raw)] ?? 0;
      if (bp !== ap) return bp - ap;
      return a.eventTime.getTime() - b.eventTime.getTime();
    });
    const primary = groupRows[0];
    const subs = groupRows.slice(1).map((r) => {
      const k = eventKeyFromRaw(r.raw);
      return k.replace(/^sshd_/, ""); // "sshd_sftp_session" → "sftp_session"
    });
    out.push({
      ...primary,
      sessionSubsessions: [...new Set(subs)],
      sessionEventCount: groupRows.length,
    });
  }
  // Final order: most recent first
  out.sort((a, b) => b.eventTime.getTime() - a.eventTime.getTime());
  return out;
}
