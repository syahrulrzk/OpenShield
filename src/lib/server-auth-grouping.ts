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
//
// Hidden events (priority = 0, dropped from grouping entirely):
//   - sshd_connection: handshake only, no user. Visible via ?showConnection=1.
//   - sshd_conn_closed: parser bug — captures IP as user, ip=?. Low-signal.
//   - sshd_shell_session: subsystem metadata. Already covered by accepted row.
//
// 2026-06-21: Following Bos feedback "bro ini kayak ya masih ada bug deh,
// gw login lewat terminal cuma skali, ini malah banyak log ya, knpa ay" —
// we now drop the 3-4 low-signal events per session and only show the
// meaningful accepted/failed + sftp/scp_session events as primary rows.
const EVENT_PRIORITY: Record<string, number> = {
  sshd_accepted: 100,
  sshd_failed: 95,
  sshd_sftp_session: 80,
  sshd_scp_session: 80,
  sshd_command_session: 60, // only if cmd != "(no command)" — filtered below
  sshd_shell_session: 0,    // dropped (subsystem metadata)
  sshd_connection: 0,       // dropped (no user, low-signal)
  sshd_conn_closed: 0,      // dropped (parser bug: user=ip)
};

/** Filter rows that should be hidden from the UI entirely. */
function isHiddenEvent(raw: string | null | undefined): boolean {
  if (!raw) return false;
  if (raw.includes("|sshd.shell_session")) return true;
  if (raw.includes("|sshd.conn_closed")) return true;
  // Drop command_session events that have no real command (placeholder).
  // Real commands are present in the message body.
  if (raw.includes("|sshd.command_session") && raw.includes("cmd=(no command)")) {
    return true;
  }
  return false;
}

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
  // Pre-filter: drop low-signal events (shell_session, conn_closed,
  // command_session with no command, connection handshake).
  // These carry no useful information for the dashboard view.
  // ?showConnection=1 in the API route re-adds connection events if needed.
  const filteredRows = rows.filter((r) => !isHiddenEvent(r.raw));

  const groups = new Map<string, RawServerAuthRow[]>();
  for (const r of filteredRows) {
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
    // Drop hidden events from subsessions list too (shouldn't appear since
    // we pre-filtered, but defensive in case future hidden-events still
    // surface as subsession for some reason).
    const visibleSubs = subs.filter(
      (s) => s !== "shell_session" && s !== "conn_closed" && s !== "connection",
    );
    out.push({
      ...primary,
      sessionSubsessions: [...new Set(visibleSubs)],
      sessionEventCount: groupRows.length,
    });
  }
  // Final order: most recent first
  out.sort((a, b) => b.eventTime.getTime() - a.eventTime.getTime());
  return out;
}
