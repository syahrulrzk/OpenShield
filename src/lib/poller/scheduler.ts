/**
 * OpenShield — In-process poller scheduler
 *
 * Starts a setInterval that calls /api/poller/run with HMAC auth every
 * POLLER_INTERVAL_SECONDS. Only runs when POLLER_ENABLED=true.
 *
 * This runs inside the Next.js server process — single instance, no
 * separate worker needed for MVP. For HA, use a sidecar cron container.
 */

import { signBody, getIngestSecret } from "@/lib/ingest/hmac";

const POLLER_ID = "in-process-scheduler";

let started = false;
let interval: NodeJS.Timeout | null = null;

export function startPollerScheduler() {
  if (started) return;
  if (process.env.POLLER_ENABLED !== "true") {
    console.log("[scheduler] POLLER_ENABLED != true, skipping");
    return;
  }

  const seconds = parseInt(process.env.POLLER_INTERVAL_SECONDS ?? "30", 10);
  if (isNaN(seconds) || seconds < 5) {
    console.error("[scheduler] Invalid POLLER_INTERVAL_SECONDS, using 30");
  }
  const intervalMs = (isNaN(seconds) || seconds < 5 ? 30 : seconds) * 1000;

  const baseUrl =
    process.env.OPENSHIELD_BASE_URL ?? "http://127.0.0.1:3000";

  const tick = async () => {
    try {
      const body = JSON.stringify({});
      const secret = getIngestSecret();
      const sig = signBody(secret, body);
      const res = await fetch(`${baseUrl}/api/poller/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Openshield-Signature": sig,
          "X-Openshield-Poller-Id": POLLER_ID,
        },
        body,
        // 60s timeout — polling can be slow if many assets
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        const t = await res.text();
        console.error(
          `[scheduler] Poller cycle failed: ${res.status} ${t.slice(0, 200)}`
        );
      } else {
        const data = await res.json();
        if (data.totalAssets > 0) {
          console.log(
            `[scheduler] poll: ${data.success}✓ ${data.failed}✗ ${data.eventsCollected} events (${data.durationMs}ms)`
          );
        }
      }
    } catch (err) {
      console.error("[scheduler] Poller cycle error:", (err as Error).message);
    }
  };

  // Run once on startup after a short delay (let the app finish booting)
  setTimeout(tick, 5_000);
  interval = setInterval(tick, intervalMs);
  started = true;
  console.log(
    `[scheduler] Poller started, interval=${intervalMs / 1000}s, base=${baseUrl}`
  );
}

export function stopPollerScheduler() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
  started = false;
}
