/**
 * Robust clipboard helper — works in all contexts.
 *
 * Browser context requirements vary for clipboard APIs:
 *   - `navigator.clipboard.writeText()` requires a SECURE context
 *     (HTTPS or localhost). LAN IP (http://192.168.x.x) counts as
 *     "not secure" so this API is `undefined` and crashes with
 *     "Cannot read properties of undefined (reading 'writeText')".
 *   - `document.execCommand('copy')` works in any context but is
 *     deprecated. Still works in all modern browsers as of 2026.
 *
 * This helper tries the modern API first, then falls back to the
 * deprecated one via a temporary textarea, then returns false so
 * the caller can show a "press Ctrl+C to copy" hint.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // 1. Modern API — works on HTTPS / localhost
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or other error — fall through to execCommand
    }
  }

  // 2. Legacy fallback — works on http:// LAN IP contexts
  if (typeof document !== "undefined") {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      ta.style.left = "-9999px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      // fall through
    }
  }

  return false;
}
