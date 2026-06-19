/**
 * Next.js Instrumentation — runs once when the server starts.
 * Used to start the in-process poller scheduler.
 *
 * https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Server-side only — don't init in edge runtime
    const { startPollerScheduler } = await import("./lib/poller/scheduler");
    startPollerScheduler();
  }
}
