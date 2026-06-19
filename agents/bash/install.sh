# OpenShield Bash Agent — Installation
# ──────────────────────────────────────────────────────────────
# Run as root: sudo bash install.sh
#
# What it does:
#   1. Copy agent.sh + config to /opt/openshield-agent
#   2. Create config directory /etc/openshield (preserves existing config)
#   3. Create state directory /var/lib/openshield
#   4. Create log directory /var/log/openshield
#   5. Install systemd unit → enable on boot
#   6. Start the service
#
# Prerequisites:
#   - bash 4+ (most modern distros)
#   - coreutils, openssl, curl (all standard)
#   - jq (optional but recommended for safer JSON)

set -e

# Detect if running as root
if [[ $EUID -ne 0 ]]; then
  echo "Please run as root: sudo bash $0" >&2
  exit 1
fi

# Install paths
INSTALL_DIR="/opt/openshield-agent"
CONFIG_DIR="/etc/openshield"
CONFIG_FILE="$CONFIG_DIR/agent.json"
STATE_DIR="/var/lib/openshield"
LOG_DIR="/var/log/openshield"
SERVICE_FILE="/etc/systemd/system/openshield-agent.service"
SCRIPT_NAME="agent.sh"

echo "→ Creating directories"
mkdir -p "$INSTALL_DIR" "$CONFIG_DIR" "$STATE_DIR" "$LOG_DIR"

echo "→ Copying agent script"
install -m 0755 "$(dirname "$0")/$SCRIPT_NAME" "$INSTALL_DIR/$SCRIPT_NAME"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "→ Creating default config at $CONFIG_FILE (EDIT THIS with your credentials!)"
  install -m 0600 "$(dirname "$0")/config.example.json" "$CONFIG_FILE"
else
  echo "→ Config $CONFIG_FILE already exists (skipping)"
fi

echo "→ Installing systemd service"
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=OpenShield Monitoring Agent (Bash)
Documentation=https://github.com/your-org/openshield
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$INSTALL_DIR/$SCRIPT_NAME -c $CONFIG_FILE
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
echo "✅ OpenShield Bash Agent installed!"
echo ""
echo "Next steps:"
echo "  1. Edit $CONFIG_FILE and paste your credentials from OpenShield UI"
echo "  2. sudo systemctl restart openshield-agent"
echo "  3. Check status: sudo systemctl status openshield-agent"
echo "  4. View logs:   sudo journalctl -u openshield-agent -f"
echo "                  tail -f $LOG_DIR/agent.log"
