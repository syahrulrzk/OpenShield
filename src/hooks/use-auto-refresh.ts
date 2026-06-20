/**
 * useAutoRefresh — silent background access-token refresh.
 *
 * Mount once in dashboard shell. Polls /api/auth/me every 60s; if the
 * JWT expires in < 5 minutes, calls /api/auth/refresh to rotate both
 * cookies. On refresh failure, redirects to /login.
 *
 * Behavior:
 *   - Skips polling when document is hidden (browser tab in background)
 *   - Throttles to one refresh in flight (no parallel calls)
 *   - Cleans up timers on unmount
 *
 * The refresh endpoint itself rotates the refresh token (OWASP A07 best
 * practice) and re-issues the access token, so the user stays logged in
 * indefinitely as long as they keep the browser tab open within the
 * 7-day refresh-token TTL.
 */
"use client";

import { useEffect, useRef } from "react";

const POLL_MS = 60_000; // check every 60s
const REFRESH_THRESHOLD_S = 5 * 60; // refresh if < 5 min until expiry

export function useAutoRefresh() {
  const inFlight = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function check() {
      if (document.hidden) {
        schedule();
        return;
      }
      if (inFlight.current) {
        schedule();
        return;
      }

      try {
        const r = await fetch("/api/auth/me", { cache: "no-store", credentials: "same-origin" });
        if (r.status === 401) {
          // Session truly dead → force re-login
          window.location.href = "/login?expired=1";
          return;
        }
        if (!r.ok) {
          schedule();
          return;
        }
        const data = (await r.json()) as { exp?: number; now?: number };
        const exp = data.exp ?? 0;
        const now = data.now ?? Math.floor(Date.now() / 1000);
        const secondsLeft = exp - now;

        if (secondsLeft < REFRESH_THRESHOLD_S) {
          await doRefresh();
        }
      } catch {
        // Network blip — retry next tick
      } finally {
        schedule();
      }
    }

    async function doRefresh() {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const r = await fetch("/api/auth/refresh", {
          method: "POST",
          credentials: "same-origin",
        });
        if (!r.ok) {
          // Refresh token expired or revoked → re-login
          window.location.href = "/login?expired=1";
        }
      } catch {
        // ignore — next tick will retry
      } finally {
        inFlight.current = false;
      }
    }

    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(check, POLL_MS);
    }

    // Kick off after a short delay so we don't race the initial RSC fetch
    timer = setTimeout(check, 5_000);

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, []);
}