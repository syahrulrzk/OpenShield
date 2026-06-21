#!/usr/bin/env bash
# scripts/check-agent-sync.sh
# ─────────────────────────────────────────────────────────────
# Guard script: fails if agents/python/agent.py is out of sync
# with the live source, or if AGENT_COMPAT.latest doesn't match
# the VERSION constant baked into agent.py.
#
# Why: every time we patch /opt/openshield-agent/agent.py on the
# live host (Linux / Mac / Windows dev box), we MUST also:
#   1. Copy → agents/python/agent.py (source-of-truth for installers)
#   2. Bump VERSION = "X.Y.Z" inside agent.py
#   3. Bump AGENT_COMPAT.latest in src/lib/agent-versions.ts
#
# This script enforces (1) and (2)+(3) so we never ship a stale
# installer. Run via:
#   npm run check-agent
# or in pre-commit hook (auto-installed by Husky).
#
# Exit codes:
#   0 — all synced
#   1 — drift detected
#   2 — script misuse (missing files)
# ─────────────────────────────────────────────────────────────

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIVE_AGENT="${LIVE_AGENT:-/opt/openshield-agent/agent.py}"
SOURCE_AGENT="${REPO_ROOT}/agents/python/agent.py"
VERSIONS_TS="${REPO_ROOT}/src/lib/agent-versions.ts"

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
bold()   { printf '\033[1m%s\033[0m\n' "$*"; }

fail=0

bold "🔍 OpenShield Agent Sync Check"
echo "──────────────────────────────────────────"

# ── 1. Live agent exists? ──────────────────────────────────
if [[ ! -f "$LIVE_AGENT" ]]; then
  yellow "⚠️  Live agent not found at $LIVE_AGENT (skipping diff vs live)"
  echo "    (Normal on dev workstations where agent runs in another host.)"
  live_skip=1
else
  live_skip=0
fi

# ── 2. Source-of-truth vs live ─────────────────────────────
if [[ $live_skip -eq 0 ]]; then
  if ! diff -q "$LIVE_AGENT" "$SOURCE_AGENT" >/dev/null 2>&1; then
    red "❌ DRIFT: $LIVE_AGENT differs from $SOURCE_AGENT"
    echo "    Fix: cp $LIVE_AGENT $SOURCE_AGENT"
    fail=1
  else
    green "✅ Live agent == source-of-truth"
  fi
fi

# ── 3. Version consistency (agent.py ↔ agent-versions.ts) ──
if [[ ! -f "$SOURCE_AGENT" ]]; then
  red "❌ Missing $SOURCE_AGENT"; exit 2
fi
if [[ ! -f "$VERSIONS_TS" ]]; then
  red "❌ Missing $VERSIONS_TS"; exit 2
fi

# Extract VERSION = "X.Y.Z" from agent.py
agent_ver=$(grep -E '^VERSION\s*=\s*"' "$SOURCE_AGENT" | head -1 | sed -E 's/.*"([^"]+)".*/\1/')
if [[ -z "$agent_ver" ]]; then
  red "❌ Could not parse VERSION from $SOURCE_AGENT"; exit 2
fi

# Extract AGENT_COMPAT.latest from agent-versions.ts
compat_latest=$(grep -E '^\s*latest:\s*"' "$VERSIONS_TS" | head -1 | sed -E 's/.*"([^"]+)".*/\1/')
compat_min=$(grep -E '^\s*min:\s*"' "$VERSIONS_TS" | head -1 | sed -E 's/.*"([^"]+)".*/\1/')

if [[ -z "$compat_latest" ]]; then
  red "❌ Could not parse AGENT_COMPAT.latest from $VERSIONS_TS"; exit 2
fi

echo ""
bold "📦 Version Pinning"
echo "    agent.py          VERSION       = $agent_ver"
echo "    agent-versions.ts AGENT_COMPAT  = { min: $compat_min, latest: $compat_latest }"

if [[ "$agent_ver" != "$compat_latest" ]]; then
  red ""
  red "❌ VERSION MISMATCH: agent.py reports $agent_ver but installer advertises $compat_latest"
  echo "    Fix: bump one of them so they match."
  echo "    - Edit $SOURCE_AGENT: VERSION = \"$compat_latest\""
  echo "    - Or edit $VERSIONS_TS: latest: \"$agent_ver\""
  fail=1
elif [[ "$agent_ver" < "$compat_min" ]] && [[ "$agent_ver" != "$compat_min" ]]; then
  # Note: simple lexicographic check is good enough for X.Y.Z where
  # we always bump on the same major. Replace with semver compare
  # if we ever release 2.x.
  red ""
  red "❌ agent.py VERSION $agent_ver is below AGENT_COMPAT.min $compat_min"
  fail=1
else
  green "✅ Version pin consistent"
fi

# ── 4. Endpoint sanity check (best-effort) ─────────────────
echo ""
bold "🌐 Endpoint sanity check (live server)"
SERVER_URL="${SERVER_URL:-http://127.0.0.1:3001}"
served=$(curl -sf "${SERVER_URL}/api/install/raw/agent.py" 2>/dev/null | wc -c || echo "0")
if [[ "$served" -gt 0 ]]; then
  served_ver=$(curl -sf "${SERVER_URL}/api/install/raw/agent.py" 2>/dev/null \
    | grep -E '^VERSION\s*=\s*"' | head -1 | sed -E 's/.*"([^"]+)".*/\1/' || echo "")
  if [[ -z "$served_ver" ]]; then
    yellow "⚠️  Could not parse VERSION from served installer"
  elif [[ "$served_ver" != "$agent_ver" ]]; then
    red "❌ INSTALLER DRIFT: server is serving agent.py v$served_ver, but repo has v$agent_ver"
    echo "    The Next.js process is reading from a cached copy."
    echo "    Fix: clear /home/linux/openshield/agents/python/__pycache__"
    echo "         and restart 'sudo systemctl restart openshield-dev'"
    fail=1
  else
    green "✅ Installer endpoint serves v$agent_ver"
  fi
else
  yellow "⚠️  Could not reach ${SERVER_URL}/api/install/raw/agent.py (skipping)"
fi

echo ""
echo "──────────────────────────────────────────"
if [[ $fail -eq 0 ]]; then
  green "🎉 All agent sync checks PASSED"
  exit 0
else
  red "💥 Agent sync check FAILED — see messages above"
  exit 1
fi
