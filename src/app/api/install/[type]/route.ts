/**
 * /api/install/[type]?agent_id=XXX&token=XXX
 *
 * Returns a self-contained bash installer script with config pre-baked.
 * Inspired by Wazuh's one-command install pattern:
 *   curl -sL ".../api/install/bash?agent_id=XXX&token=XXX" | sudo bash
 *
 * The script:
 *   1. Detects hostname / IP / OS / kernel automatically
 *   2. Writes /etc/openshield/agent.json (chmod 600)
 *   3. Downloads the matching agent binary to /opt/openshield-agent
 *   4. Installs Python deps (python agent only)
 *   5. Sets up systemd service with hardening
 *   6. Starts the agent
 *
 * Auth: NONE — the URL itself is the bearer credential (agent_id + token).
 */

import { prisma } from "@/lib/db";
import { audit } from "@/lib/security/audit";

const VALID_TYPES = ["python"] as const;
type AgentType = (typeof VALID_TYPES)[number];
/**
 * Bash installer is DEPRECATED (2026-06-20).
 * The bash agent suffered a stable pipe_read hang after 1-2 heartbeats.
 * Switched dev_linux to Python agent (verified end-to-end, no hang).
 * Re-installing with bash is no longer supported — use Python.
 */

function isValidCreds(agentId: string, token: string): boolean {
  return (
    /^[a-z0-9]{20,30}$/.test(agentId) &&
    /^os_agt_[a-f0-9]{50,80}$/.test(token)
  );
}

function bashQuote(s: string): string {
  // Wrap in single quotes; escape any single quotes inside
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function buildInstaller(opts: {
  type: AgentType;
  agentId: string;
  token: string;
  serverUrl: string;
  agentName: string;
}): string {
  const { type, agentId, token, serverUrl, agentName } = opts;
  const server = serverUrl.replace(/\/+$/, "");
  // JSON-stringified values for embedding inside the config heredoc
  const J_SERVER = JSON.stringify(server);
  const J_AGENT_ID = JSON.stringify(agentId);
  const J_TOKEN = JSON.stringify(token);
  const J_NAME = JSON.stringify(agentName);
  const generated = new Date().toISOString();
  const bashUrl = `${server}/api/install/raw/agent.sh`;
  const pyUrl = `${server}/api/install/raw/agent.py`;
  const installUrl = `curl -sL ${server}/api/install/${type}?agent_id=${agentId}&token=${token} | sudo bash`;

  return `#!/usr/bin/env bash
# OpenShield Agent — Quick Installer (${type.toUpperCase()})
# Generated: ${generated}
# Server:     ${server}
# Agent:      ${agentName} (${agentId})
#
# Usage:      ${installUrl}
set -euo pipefail

# ============== Pre-baked config ==============
AGENT_ID=${J_AGENT_ID}
AGENT_TOKEN=${J_TOKEN}
AGENT_NAME=${J_NAME}
AGENT_TYPE=${JSON.stringify(type)}
SERVER_URL=${J_SERVER}

# ============== Sanity checks ==============
# Allow non-root for sandbox testing via OPENSHIELD_REQUIRE_ROOT=0
if [[ "\${OPENSHIELD_REQUIRE_ROOT:-1}" == "1" && $EUID -ne 0 ]]; then
  echo "❌ Harus run as root (sudo)."
  echo "   Usage: ${installUrl}"
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "❌ curl not found. Install curl dulu (apt install curl / yum install curl)."
  exit 1
fi

# ============== Auto-detect ==============
HOST_NAME=$(hostname -f 2>/dev/null || hostname 2>/dev/null || echo unknown)
IP_ADDR=$(hostname -I 2>/dev/null | awk '{print $1}')
[[ -z "$IP_ADDR" ]] && IP_ADDR=$(hostname -i 2>/dev/null | awk '{print $1}')
OS_NAME=$(uname -s)
KERNEL=$(uname -r)

echo ""
echo "═══════════════════════════════════════════════"
echo "  OpenShield Agent Installer"
echo "═══════════════════════════════════════════════"
echo "  Type:     $AGENT_TYPE"
echo "  Name:     $AGENT_NAME"
echo "  Server:   $SERVER_URL"
echo "  Hostname: $HOST_NAME"
echo "  IP:       $IP_ADDR"
echo "  OS:       $OS_NAME $KERNEL"
echo "═══════════════════════════════════════════════"
echo ""

# ============== Install paths ==============
# Override via env for sandbox/testing (defaults: /opt + /etc/openshield)
INSTALL_DIR="\${INSTALL_DIR:-/opt/openshield-agent}"
CONFIG_FILE="\${CONFIG_FILE:-/etc/openshield/agent.json}"
SERVICE_NAME="\${SERVICE_NAME:-openshield-agent}"

mkdir -p "$(dirname "$CONFIG_FILE")" "$INSTALL_DIR"

# ============== Clean stale state from previous installs ==============
# Bos requirement: agent ID gak berubah pas reinstall → we keep state files
# only for same-agent-id, drop them when agent_id changes (otherwise agent
# warns 'Agent ID in state file differs from config' forever).
STATE_DIR="\${STATE_DIR:-/var/lib/openshield}"
# Note: state filename is agent.state (key=value format), NOT agent.json
if [[ -f "$STATE_DIR/agent.state" ]]; then
  STALE_ID=$(grep -E '^agent_id=' "$STATE_DIR/agent.state" 2>/dev/null | head -1 | cut -d= -f2)
  if [[ -n "$STALE_ID" && "$STALE_ID" != "$AGENT_ID" ]]; then
    echo "→ Detected stale state from previous agent ($STALE_ID), clearing..."
    rm -f "$STATE_DIR/agent.state" "$STATE_DIR/log_offsets.json" "$STATE_DIR/fim_baseline.json"
  fi
fi
if [[ -f "$STATE_DIR/agent.json" ]]; then
  # Also clean any legacy agent.json from previous broken installs
  rm -f "$STATE_DIR/agent.json"
  echo "→ Removed legacy agent.json state file"
fi
# Also remove legacy YAML config (different format, confuses agent)
if [[ -f "/etc/openshield/agent.yaml" ]]; then
  echo "→ Removing legacy YAML config (replaced by JSON)"
  rm -f /etc/openshield/agent.yaml
fi
# Reset log offsets too — agent may have stale offsets from old installation
# (different paths, different parser state)
if [[ -f "$STATE_DIR/log_offsets.json" ]]; then
  STALE_LOG_OFFSETS=$(cat "$STATE_DIR/log_offsets.json" 2>/dev/null)
  if [[ -n "$STALE_LOG_OFFSETS" ]]; then
    echo "→ Resetting stale log offsets (re-detect on first heartbeat)"
    rm -f "$STATE_DIR/log_offsets.json"
  fi
fi

# ============== Write config ==============
cat > "$CONFIG_FILE" <<CFG
{
  "server_url": ${J_SERVER},
  "agent_id": ${J_AGENT_ID},
  "secret_token": ${J_TOKEN},
  "agent_name": ${J_NAME},
  "heartbeat_interval": 30,
  "log_watchers": [
    { "path": "/var/log/auth.log", "parser": "sshd" },
    { "path": "/var/log/secure", "parser": "sshd" },
    { "path": "/var/log/syslog", "parser": "syslog" }
  ],
  "fim_paths": [
    "/etc/passwd",
    "/etc/shadow",
    "/etc/sudoers",
    "/etc/ssh/sshd_config"
  ],
  "process_watchlist": [
    "xmrig",
    "minerd",
    "kdevtmpfsi",
    "kinsing",
    "nc -e",
    "ncat -e",
    "bash -i",
    "/dev/tcp"
  ]
}
CFG
chmod 600 "$CONFIG_FILE"
echo "✓ Config written: $CONFIG_FILE"

# ============== Download agent binary ==============
if [[ "$AGENT_TYPE" == "bash" ]]; then
  curl -fsSL "${bashUrl}" -o "$INSTALL_DIR/agent.sh"
  chmod +x "$INSTALL_DIR/agent.sh"
  AGENT_CMD="$INSTALL_DIR/agent.sh -c $CONFIG_FILE"
  echo "✓ Bash agent installed: $INSTALL_DIR/agent.sh"
else
  curl -fsSL "${pyUrl}" -o "$INSTALL_DIR/agent.py"
  chmod +x "$INSTALL_DIR/agent.py"
  # Resolve python3 path: on CentOS 7 (SCL) the symlink lives at /usr/local/bin/python3,
  # otherwise /usr/bin/python3. Set early so the version check, install, and systemd unit all agree.
  if [[ -x /usr/local/bin/python3 ]]; then
    PYTHON3_BIN="/usr/local/bin/python3"
  else
    PYTHON3_BIN="/usr/bin/python3"
  fi
  AGENT_CMD="$PYTHON3_BIN $INSTALL_DIR/agent.py -c $CONFIG_FILE"

  echo "→ Installing Python dependencies (PEP 668 safe)"
  # Ubuntu 24.04+ blocks system pip (PEP 668). Use system packages instead.
  # Cross-distro: apt (Debian/Ubuntu) / dnf (RHEL/Fedora) / yum (CentOS) / apk (Alpine)
  if command -v apt-get >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      python3-requests python3-yaml python3-psutil 2>&1 | grep -v "^Reading\|^Building\|^Get:\|^Selecting\|^Preparing\|^Unpacking\|^Setting\|^0 upgraded" || true
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y python3-requests python3-pyyaml python3-psutil 2>&1 | tail -3 || true
  elif command -v yum >/dev/null 2>&1; then
    # CentOS 7 detection: base repo has no python3 (only 2.7).
    # Must use Software Collections (SCL) — rh-python38.
    if [[ -f /etc/centos-release ]] && grep -q "release 7" /etc/centos-release; then
      echo "→ Detected CentOS 7 — installing Python 3 via Software Collections (SCL)"
      yum install -y centos-release-scl 2>&1 | tail -2 || true
      yum install -y rh-python38 rh-python38-python-pip rh-python38-python-devel 2>&1 | tail -2 || true
      ln -sf /opt/rh/rh-python38/root/bin/python3 /usr/local/bin/python3
      ln -sf /opt/rh/rh-python38/root/bin/pip3     /usr/local/bin/pip3
      cat > /etc/profile.d/openshield-python.sh <<'PROFILE_EOF'
source /opt/rh/rh-python38/enable 2>/dev/null || true
export PATH="/opt/rh/rh-python38/root/bin:$PATH"
PROFILE_EOF
      chmod 0644 /etc/profile.d/openshield-python.sh
      /usr/local/bin/python3 -m pip install --quiet requests pyyaml psutil 2>&1 | tail -3 || true
    else
      yum install -y python3-requests python3-pyyaml python3-psutil 2>&1 | tail -3 || true
    fi
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache py3-requests py3-yaml py3-psutil 2>&1 | tail -3 || true
  else
    echo "⚠️  No supported package manager found."
    echo "   Please install manually: requests, PyYAML, psutil (system Python 3.8+)"
    exit 1
  fi
  # Verify imports — fail fast if anything is missing
  "$PYTHON3_BIN" -c "import requests, yaml, psutil" 2>&1 || { echo "❌ Python deps missing after install"; exit 1; }
  echo "✓ Python agent installed: $INSTALL_DIR/agent.py (deps via system pkg manager)"
fi

# ============== Systemd service ==============
# Skip systemd unit install if SKIP_SYSTEMD=1 or systemd unit path not writable
SKIP_SYSTEMD="\${SKIP_SYSTEMD:-0}"
SERVICE_FILE="/etc/systemd/system/$SERVICE_NAME.service"
SYSTEMD_OK=0
if [[ "$SKIP_SYSTEMD" != "1" ]] && command -v systemctl >/dev/null 2>&1; then
  if [[ -w "/etc/systemd/system" || -w "$(dirname "$SERVICE_FILE")" ]]; then
    SYSTEMD_OK=1
  fi
fi
if [[ "$SYSTEMD_OK" == "1" ]]; then
# Pre-create state/log dirs (root context, no systemd restrictions here)
echo "→ Creating state and log directories"
mkdir -p /var/lib/openshield /var/log/openshield 2>/dev/null
chmod 755 /var/lib/openshield /var/log/openshield 2>/dev/null
# Fallback: if /var is read-only or restricted, use /tmp (less secure but functional)
if ! [[ -w /var/lib/openshield ]]; then
  echo "⚠️  /var/lib/openshield not writable, falling back to /tmp/openshield-state"
  mkdir -p /tmp/openshield-state /tmp/openshield-log
  chmod 755 /tmp/openshield-state /tmp/openshield-log
fi
cat > "$SERVICE_FILE" <<UNIT
[Unit]
Description=OpenShield Agent ($AGENT_NAME)
Documentation=https://openshield.local
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
Group=root
ExecStart=$AGENT_CMD
Restart=always
RestartSec=10
TimeoutStopSec=15
StandardOutput=journal
StandardError=journal

# Hardening (root-proof edition: dirs pre-created by installer; relaxed ProtectSystem to allow writes)
NoNewPrivileges=false
# SupplementaryGroups=adm allows root agent to read group-restricted logs
# like /var/log/auth.log (mode 0640, owned by syslog:adm on Debian/Ubuntu).
# Without this, agent gets PermissionDenied on auth.log under ProtectSystem=full.
SupplementaryGroups=adm
ProtectSystem=full
ProtectHome=false
PrivateTmp=true
ReadWritePaths=$INSTALL_DIR /var/log /etc/openshield /var/lib/openshield /var/log/openshield
CapabilityBoundingSet=
RestrictSUIDSGID=true
LockPersonality=true
RestrictRealtime=true
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
UNIT

# daemon-reload with error capture (don't fail entire install if systemd unavailable)
if ! systemctl daemon-reload 2>&1; then
  echo "⚠️  systemctl daemon-reload failed (broken systemd?)"
  SYSTEMD_OK=0
fi
if [[ "$SYSTEMD_OK" == "1" ]]; then
  systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || echo "⚠️  systemctl enable failed (will not auto-start on boot)"
  if ! systemctl restart "$SERVICE_NAME" 2>&1; then
    echo "⚠️  systemctl restart failed — check: systemctl status $SERVICE_NAME"
    SYSTEMD_OK=0
  fi
fi
if [[ "$SYSTEMD_OK" == "1" ]]; then
  echo "✓ Systemd service: $SERVICE_NAME (enabled + started)"
fi

echo ""
echo "═══════════════════════════════════════════════"
echo "  ✅ OpenShield Agent is RUNNING"
echo "═══════════════════════════════════════════════"
echo "  Status:  systemctl status $SERVICE_NAME"
echo "  Logs:    journalctl -u $SERVICE_NAME -f"
echo "  Stop:    sudo systemctl stop $SERVICE_NAME"
echo "═══════════════════════════════════════════════"
else
echo "⚠️  systemd not found or no write access — agent installed but NOT auto-started."
echo "   Start manually:  $AGENT_CMD"
fi

sleep 2
if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  echo "✓ Agent is active. Check OpenShield dashboard in ~10s."
else
  echo "⚠️  Service not active yet. Check logs above."
fi

# ============== Final banner (always shown) ==============
echo ""
echo "═══════════════════════════════════════════════"
echo "  ✅ OpenShield Agent INSTALLED"
echo "═══════════════════════════════════════════════"
echo "  Config:    $CONFIG_FILE"
echo "  Binary:    $INSTALL_DIR/agent.sh"
echo "  Start:     $AGENT_CMD"
echo "  Dashboard: $SERVER_URL/dashboard/agents"
echo "═══════════════════════════════════════════════"
`;
}


export async function GET(
  req: Request,
  { params }: { params: Promise<{ type: string }> },
) {
  const url = new URL(req.url);
  const { type: rawType } = await params;
  const type = rawType.toLowerCase() as AgentType;

  if (!VALID_TYPES.includes(type)) {
    return Response.json(
      { error: `Invalid type. Expected one of: ${VALID_TYPES.join(", ")}` },
      { status: 400 },
    );
  }

  const agentId = url.searchParams.get("agent_id") || "";
  const token = url.searchParams.get("token") || "";

  if (!isValidCreds(agentId, token)) {
    return Response.json(
      {
        error:
          "Missing or malformed agent_id / token. URL must include ?agent_id=XXX&token=XXX",
      },
      { status: 400 },
    );
  }

  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { id: true, name: true, type: true, status: true },
  });
  if (!agent) {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }
  if (agent.status === "REVOKED") {
    return Response.json(
      { error: "Agent is revoked — cannot reinstall" },
      { status: 403 },
    );
  }
  if (agent.type.toLowerCase() !== type) {
    return Response.json(
      {
        error: `Type mismatch. Agent is ${agent.type}, installer requested ${type}.`,
      },
      { status: 400 },
    );
  }

  const proto =
    req.headers.get("x-forwarded-proto") ||
    (url.hostname === "localhost" ? "http" : "https");
  const host = req.headers.get("host") || url.host;
  const serverUrl =
    process.env.OPENSHIELD_PUBLIC_URL ||
    process.env.PUBLIC_URL ||
    process.env.OPENSHIELD_BASE_URL ||
    `${proto}://${host}`;

  const script = buildInstaller({
    type,
    agentId: agent.id,
    token,
    serverUrl,
    agentName: agent.name,
  });

  await audit({
    action: "agent.install_script.generated",
    resourceType: "agent",
    resourceId: agent.id,
    metadata: { type, installerBytes: script.length },
  });

  return new Response(script, {
    status: 200,
    headers: {
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "Content-Disposition": `inline; filename="openshield-${type}-install.sh"`,
      "Cache-Control": "no-store",
    },
  });
}
