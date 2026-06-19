/**
 * OpenShield — SSH Poller
 *
 * Connects to a target asset via SSH, reads incremental portion of
 * /var/log/auth.log (or /var/log/secure on RHEL), parses SSH login events,
 * and returns normalized events ready for the ingest endpoint.
 *
 * Auth: key or password (decrypted from AssetCredential)
 * Cursor: byte offset stored in asset.pollerCursor (incremental reads)
 *
 * Supported auth.log patterns (syslog + journald export):
 *   - "Accepted publickey for <user> from <ip> port <port> ssh2"
 *   - "Accepted password for <user> from <ip> port <port> ssh2"
 *   - "Failed password for <user> from <ip> port <port> ssh2"
 *   - "Invalid user <user> from <ip> port <port>"
 *   - "Connection closed by authenticating user <user> <ip> port <port> [preauth]"
 *
 * Note: This poller intentionally does NOT execute arbitrary commands —
 * only read access to the auth log via sudo. This is the safe subset.
 */

import { Client, type ConnectConfig } from "ssh2";
import { decrypt } from "@/lib/security/crypto";
import type { SshEventInput } from "./types";

const AUTH_LOG_PATHS = [
  "/var/log/auth.log", // Debian/Ubuntu
  "/var/log/secure", // RHEL/CentOS/Rocky
  "/var/log/messages", // fallback (rare)
];

// Permission: read auth.log. Use sudo only if needed (when file is 0600 root).
// We use `cat` with sudo -n (non-interactive) so it fails fast if no sudo.
const READ_CMD = (path: string) =>
  `if [ -r '${path}' ]; then cat '${path}'; else sudo -n cat '${path}' 2>/dev/null; fi`;

export type SshPollResult = {
  ok: boolean;
  newCursor: string | null;
  events: SshEventInput[];
  bytesRead: number;
  error?: string;
};

/**
 * Connect to an SSH asset and pull new SSH events since the last cursor.
 * Returns parsed events + the new byte cursor.
 */
export async function pollSshAsset(params: {
  hostname: string;
  sshPort: number;
  sshUser: string;
  authType: "key" | "password";
  /** Decrypted SSH private key contents (PEM) OR password plaintext */
  credential: string;
  /** Previous cursor — last byte position read */
  cursor: string | null;
  /** Read only events after this time (defaults to 1h ago) */
  sinceMs?: number;
}): Promise<SshPollResult> {
  const { hostname, sshPort, sshUser, authType, credential, cursor, sinceMs } =
    params;

  const config: ConnectConfig = {
    host: hostname,
    port: sshPort,
    username: sshUser,
    readyTimeout: 15_000,
    // Don't try agent / interactive
    tryKeyboard: false,
  };

  if (authType === "password") {
    config.password = credential;
  } else {
    config.privateKey = credential;
  }

  return new Promise((resolve) => {
    const conn = new Client();
    let resolved = false;
    const safeResolve = (r: SshPollResult) => {
      if (resolved) return;
      resolved = true;
      try {
        conn.end();
      } catch {}
      resolve(r);
    };

    const timeout = setTimeout(() => {
      safeResolve({
        ok: false,
        newCursor: cursor,
        events: [],
        bytesRead: 0,
        error: "SSH connect timeout (15s)",
      });
    }, 20_000);

    conn.on("ready", () => {
      // Try each auth log path until one works
      tryAuthLog(0);
    });

    function tryAuthLog(idx: number) {
      if (idx >= AUTH_LOG_PATHS.length) {
        clearTimeout(timeout);
        return safeResolve({
          ok: false,
          newCursor: cursor,
          events: [],
          bytesRead: 0,
          error: `No readable auth log at: ${AUTH_LOG_PATHS.join(", ")}`,
        });
      }
      const path = AUTH_LOG_PATHS[idx];

      conn.sftp((err, sftp) => {
        if (err) {
          // SFTP not available — fall back to exec cat
          return execRead(path, idx);
        }
        sftp.stat(path, (statErr, stats) => {
          if (statErr || !stats) {
            sftp.end();
            return execRead(path, idx);
          }
          const startByte = cursor ? parseInt(cursor, 10) : 0;
          // If log rotated (size < startByte), reset to 0
          const effectiveStart =
            stats.size < startByte ? 0 : startByte;
          const readLen = stats.size - effectiveStart;
          if (readLen <= 0) {
            clearTimeout(timeout);
            sftp.end();
            return safeResolve({
              ok: true,
              newCursor: String(stats.size),
              events: [],
              bytesRead: 0,
            });
          }
          const stream = sftp.createReadStream(path, {
            start: effectiveStart,
            end: stats.size - 1,
          });
          let buf = "";
          stream.on("data", (chunk: Buffer) => {
            buf += chunk.toString("utf8");
          });
          stream.on("end", () => {
            clearTimeout(timeout);
            sftp.end();
            const events = parseAuthLog(buf, sinceMs);
            safeResolve({
              ok: true,
              newCursor: String(stats.size),
              events,
              bytesRead: readLen,
            });
          });
          stream.on("error", (e: Error) => {
            void e;
            sftp.end();
            // Fall through to next path
            tryAuthLog(idx + 1);
          });
        });
      });
    }

    function execRead(path: string, idx: number) {
      conn.exec(READ_CMD(path), (err, stream) => {
        if (err) {
          return tryAuthLog(idx + 1);
        }
        let buf = "";
        stream.on("data", (chunk: Buffer) => {
          buf += chunk.toString("utf8");
        });
        stream.on("close", (code: number) => {
          if (code !== 0) {
            return tryAuthLog(idx + 1);
          }
          clearTimeout(timeout);
          const events = parseAuthLog(buf, sinceMs);
          // No cursor without SFTP — fall back to last-line marker
          safeResolve({
            ok: true,
            newCursor: null, // will reset cursor on next run
            events,
            bytesRead: buf.length,
          });
        });
        stream.on("error", () => tryAuthLog(idx + 1));
      });
    }

    conn.on("error", (err) => {
      clearTimeout(timeout);
      safeResolve({
        ok: false,
        newCursor: cursor,
        events: [],
        bytesRead: 0,
        error: `SSH connection error: ${err.message}`,
      });
    });

    try {
      conn.connect(config);
    } catch (err) {
      clearTimeout(timeout);
      safeResolve({
        ok: false,
        newCursor: cursor,
        events: [],
        bytesRead: 0,
        error: `SSH connect threw: ${String(err)}`,
      });
    }
  });
}

/**
 * Parse /var/log/auth.log lines into normalized SSH events.
 * Supports both classic syslog format and ISO timestamps.
 */
export function parseAuthLog(
  content: string,
  sinceMs?: number
): SshEventInput[] {
  const events: SshEventInput[] = [];
  const lines = content.split("\n");

  // Regex for: "Mon DD HH:MM:SS host program[pid]: message"
  // or ISO: "2026-06-19T00:00:00.000000+00:00 host program: message"
  const syslogRe =
    /^([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+([^\s:]+)(?:\[\d+\])?:\s+(.*)$/;
  const isoRe =
    /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\s+(\S+)\s+([^\s:]+?)(?:\[\d+\])?:\s+(.*)$/;

  for (const line of lines) {
    if (!line) continue;
    let ts: Date | null = null;
    let msg = line;

    const syslogMatch = line.match(syslogRe);
    const isoMatch = line.match(isoRe);

    if (isoMatch) {
      ts = new Date(isoMatch[1]);
      msg = isoMatch[4];
    } else if (syslogMatch) {
      // syslog "Mon DD HH:MM:SS" — no year, assume current year
      const yearStr = new Date().getFullYear().toString();
      const tsStr = `${yearStr} ${syslogMatch[1]}`;
      ts = new Date(tsStr);
      msg = syslogMatch[4];
    }

    if (!ts || isNaN(ts.getTime())) continue;
    if (sinceMs && ts.getTime() < sinceMs) continue;

    // Only parse sshd lines
    if (!/sshd/i.test(line)) continue;

    const ev = parseSshLine(msg, ts);
    if (ev) events.push(ev);
  }

  return events;
}

function parseSshLine(msg: string, ts: Date): SshEventInput | null {
  // Accepted password/publickey
  let m = msg.match(
    /Accepted\s+(publickey|password|keyboard-interactive)\s+for\s+(?:invalid user\s+)?(\S+)\s+from\s+(\S+)\s+port\s+(\d+)/
  );
  if (m) {
    return {
      username: m[2],
      sourceIp: m[3],
      status: "SUCCESS",
      method: m[1].toLowerCase(),
      eventTime: ts.toISOString(),
      raw: msg.slice(0, 500),
    };
  }

  // Failed password
  m = msg.match(
    /Failed password for (?:invalid user )?(\S+) from (\S+) port (\d+)/
  );
  if (m) {
    return {
      username: m[1],
      sourceIp: m[2],
      status: "FAILED",
      method: "password",
      eventTime: ts.toISOString(),
      raw: msg.slice(0, 500),
    };
  }

  // Invalid user (no password attempt logged but user is invalid)
  m = msg.match(/Invalid user (\S+) from (\S+)/);
  if (m) {
    return {
      username: m[1],
      sourceIp: m[2],
      status: "INVALID",
      method: "unknown",
      eventTime: ts.toISOString(),
      raw: msg.slice(0, 500),
    };
  }

  // Public key failure
  m = msg.match(
    /Failed publickey for (?:invalid user )?(\S+) from (\S+) port (\d+)/
  );
  if (m) {
    return {
      username: m[1],
      sourceIp: m[2],
      status: "FAILED",
      method: "publickey",
      eventTime: ts.toISOString(),
      raw: msg.slice(0, 500),
    };
  }

  return null;
}

/**
 * Decrypt the SSH credential from the asset's stored ciphertext.
 * Returns null if no credential or decrypt fails.
 */
export function decryptSshCredential(
  sshEncData: string | null | undefined
): string | null {
  if (!sshEncData) return null;
  try {
    return decrypt(sshEncData);
  } catch {
    return null;
  }
}
