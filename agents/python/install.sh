#!/usr/bin/env bash
# OpenShield Python Agent — Installation
# ──────────────────────────────────────────────────────────────
# Run as root: sudo bash install.sh
#
# What it does:
#   1. Install Python dependencies (requests, PyYAML, psutil)
#   2. Copy agent.py + config to /opt/openshield-agent
#   3. Create config/state/log directories
#   4. Install systemd unit → enable on boot
#   5. Start the service

set -e

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root: sudo bash $0" >&2
  exit 1
fi

INSTALL_DIR="/opt/openshield-agent"
CONFIG_DIR="/etc/openshield"
CONFIG_FILE="$CONFIG_DIR/agent.yaml"
STATE_DIR="/var/lib/openshield"
LOG_DIR="/var/log/openshield"
SERVICE_FILE="/etc/systemd/system/openshield-agent.service"

echo "→ Checking Python 3.8+"
if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 not found. Install Python 3.8+ first." >&2
  exit 1
fi

PY_VER=$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')
if python3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)"; then
  echo "  Found Python $PY_VER ✓"
else
  echo "ERROR: Python 3.8+ required (found $PY_VER)" >&2
  exit 1
fi

echo "→ Installing pip dependencies"
python3 -m pip install --quiet --break-system-packages \
  -r "$(dirname "$0")/requirements.txt" 2>/dev/null || \
python3 -m pip install --quiet \
  -r "$(dirname "$0")/requirements.txt"

echo "→ Creating directories"
mkdir -p "$INSTALL_DIR" "$CONFIG_DIR" "$STATE_DIR" "$LOG_DIR"

echo "→ Copying agent script"
install -m 0755 "$(dirname "$0")/agent.py" "$INSTALL_DIR/agent.py"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "→ Creating default config at $CONFIG_FILE (EDIT THIS with your credentials!)"
  install -m 0600 "$(dirname "$0")/config.example.yaml" "$CONFIG_FILE"
else
  echo "→ Config $CONFIG_FILE already exists (skipping)"
fi

echo "→ Installing systemd service"
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=OpenShield Monitoring Agent (Python)
Documentation=https://github.com/your-org/openshield
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 $INSTALL_DIR/agent.py -c $CONFIG_FILE
Restart=on-failure
RestartSec=10

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$STATE_DIR $LOG_DIR
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable openshield-agent.service
systemctl restart openshield-agent.service

echo ""
echo "✅ OpenShield Python Agent installed!"
echo ""
echo "Next steps:"
echo "  1. Edit $CONFIG_FILE and paste your credentials from OpenShield UI"
echo "  2. sudo systemctl restart openshield-agent"
echo "  3. Check status: sudo systemctl status openshield-agent"
echo "  4. View logs:   sudo journalctl -u openshield-agent -f"
echo "                  tail -f $LOG_DIR/agent.log"
