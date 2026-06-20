#!/usr/bin/env bash
# OpenShield Python Agent — Installation
# ──────────────────────────────────────────────────────────────
# Run as root: sudo bash install.sh
#
# What it does:
#   1. Ensure Python 3.11+ is installed (auto-install from PPA/SCL/dnf-module
#      if distro ships with older Python like 3.6/3.8)
#   2. Install Python dependencies via system package manager (PEP 668 compliant)
#      - python3-requests, python3-yaml, python3-psutil
#   3. Copy agent.py + config to /opt/openshield-agent
#   4. Create config/state/log directories
#   5. Install hardened systemd unit → enable on boot
#   6. Start the service
#
# Note: We use APT/dnf/yum/apk (not pip) for deps because:
#   - Ubuntu 24.04 (PEP 668) blocks system pip installs
#   - System packages are tested, signed, and auto-updated
#   - No venv overhead, simpler operations
#
# Python version policy:
#   - Minimum: 3.11  (security fixes until Oct 2027)
#   - Recommended: 3.12  (security fixes until Oct 2028)
#   - Bleeding edge: 3.13  (security fixes until Oct 2029)
#   - We never install Python 3.10 or older — those are EOL or near-EOL.

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

# ──────────────────────────────────────────────────────────────
# Python version policy
# ──────────────────────────────────────────────────────────────
# We REQUIRE Python >= 3.11 because:
#   - 3.8 / 3.9 / 3.10 are all in security-only mode (no new features) and
#     most are EOL by the time you read this.
#   - 3.11+ has improved TLS defaults, error messages, and security patches.
#   - The agent itself only uses stdlib (typing, re, json, urllib) so any
#     3.11+ interpreter is compatible.
PY_MIN_MAJOR=3
PY_MIN_MINOR=11
# Preferred versions in priority order (will try first → last)
PY_PREFERRED=(3.13 3.12 3.11)

# Helper: print ordered list of preferred pythons present on PATH.
# Returns absolute paths separated by newlines.
find_preferred_pythons() {
  local found=()
  for ver in "${PY_PREFERRED[@]}"; do
    # Look in standard locations + deadsnakes path + SCL path + dnf-module alt
    for cand in \
      "/usr/bin/python${ver}" \
      "/usr/local/bin/python${ver}" \
      "/opt/rh/rh-python${ver//./}/root/bin/python${ver}" \
      "/opt/python${ver}/bin/python${ver}"; do
      if [[ -x "$cand" ]]; then
        found+=("$cand")
      fi
    done
  done
  printf '%s\n' "${found[@]}"
}

# Helper: returns 0 if $1 (X.Y) >= PY_MIN_MAJOR.PY_MIN_MINOR
version_ge_min() {
  local v_major v_minor
  IFS=. read -r v_major v_minor <<<"$1"
  if [[ "$v_major" -gt "$PY_MIN_MAJOR" ]]; then return 0; fi
  if [[ "$v_major" -lt "$PY_MIN_MAJOR" ]]; then return 1; fi
  [[ "$v_minor" -ge "$PY_MIN_MINOR" ]]
}

# ──────────────────────────────────────────────────────────────
# Resolve PYTHON3_BIN (highest-version python3.X available)
# ──────────────────────────────────────────────────────────────
echo "→ Resolving Python interpreter (need >= ${PY_MIN_MAJOR}.${PY_MIN_MINOR}, prefer ${PY_PREFERRED[*]})"

# 1) Try preferred versions first
PREFERRED=$(find_preferred_pythons | head -n 1 || true)
if [[ -n "$PREFERRED" ]]; then
  PYTHON3_BIN="$PREFERRED"
else
  # 2) Fall back to whatever python3 is on PATH
  if [[ -x /usr/local/bin/python3 ]]; then
    PYTHON3_BIN="/usr/local/bin/python3"
  elif command -v python3 >/dev/null 2>&1; then
    PYTHON3_BIN="$(command -v python3)"
  else
    PYTHON3_BIN="/usr/bin/python3"
  fi
fi

if ! command -v "$PYTHON3_BIN" >/dev/null 2>&1 && [[ ! -x "$PYTHON3_BIN" ]]; then
  echo "ERROR: no python3 binary found at $PYTHON3_BIN" >&2
  exit 1
fi

PY_VER=$("$PYTHON3_BIN" -c 'import sys; print("%d.%d" % sys.version_info[:2])')

# ──────────────────────────────────────────────────────────────
# Auto-install newer Python if current is too old
# ──────────────────────────────────────────────────────────────
if ! version_ge_min "$PY_VER"; then
  echo "  Found Python $PY_VER at $PYTHON3_BIN — too old (need ${PY_MIN_MAJOR}.${PY_MIN_MINOR}+)"
  echo "→ Attempting to install a newer Python from distro repos / PPA / SCL…"

  # Detect distro family once
  DISTRO_ID=""
  if [[ -f /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    DISTRO_ID="${ID:-}"
    DISTRO_LIKE="${ID_LIKE:-}"
  fi
  echo "  Detected distro: ${DISTRO_ID:-unknown} (ID_LIKE=${DISTRO_LIKE:-})"

  install_upgraded_python() {
    case "$DISTRO_ID" in
      ubuntu)
        echo "→ Adding deadsnakes PPA (Ubuntu) for newer Python"
        apt-get update -qq
        DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
          software-properties-common ca-certificates
        add-apt-repository -y ppa:deadsnakes/ppa
        apt-get update -qq
        for ver in "${PY_PREFERRED[@]}"; do
          if DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
               "python${ver}" "python${ver}-distutils" "python${ver}-venv" 2>/dev/null; then
            # Pick the highest version that installed
            PYTHON3_BIN="/usr/bin/python${ver}"
            echo "  Installed Python $ver at $PYTHON3_BIN ✓"
            break
          fi
        done
        ;;
      debian)
        echo "→ Enabling debian backports / building from source (Debian)"
        echo "deb http://deb.debian.org/debian ${VERSION_CODENAME}-backports main" \
          > /etc/apt/sources.list.d/backports.list 2>/dev/null || true
        apt-get update -qq
        for ver in "${PY_PREFERRED[@]}"; do
          if DEBIAN_FRONTEND=noninteractive apt-get install -y -t "${VERSION_CODENAME}-backports" \
               "python${ver}" 2>/dev/null; then
            PYTHON3_BIN="/usr/bin/python${ver}"
            echo "  Installed Python $ver (backports) at $PYTHON3_BIN ✓"
            break
          fi
        done
        ;;
      rhel|rocky|almalinux|centos|ol)
        # Try dnf module first (RHEL 8+)
        if command -v dnf >/dev/null 2>&1; then
          echo "→ Enabling python311/312 module via dnf (RHEL family)"
          for ver in "${PY_PREFERRED[@]}"; do
            # Convert 3.11 → 311 (dnf module naming convention)
            mod_ver="${ver//./}"
            if dnf module enable -y "python${mod_ver}" 2>/dev/null \
               && dnf install -y "python${ver}" "python${ver}-pip" "python${ver}-devel" 2>/dev/null; then
              PYTHON3_BIN="/usr/bin/python${ver}"
              echo "  Installed Python $ver (dnf module) at $PYTHON3_BIN ✓"
              break
            fi
          done
        fi
        # CentOS 7 fallback → SCL
        if [[ ! -x "$PYTHON3_BIN" || "$PY_VER" == "3.6" || "$PY_VER" == "2.7" ]] \
           && [[ -f /etc/centos-release ]] && grep -q "release 7" /etc/centos-release; then
          echo "→ CentOS 7 fallback: installing rh-python38 from SCL"
          yum install -y centos-release-scl
          yum install -y rh-python38 rh-python38-python-pip rh-python38-python-devel
          ln -sf /opt/rh/rh-python38/root/bin/python3 /usr/local/bin/python3
          ln -sf /opt/rh/rh-python38/root/bin/pip3     /usr/local/bin/pip3
          PYTHON3_BIN="/usr/local/bin/python3"
        fi
        ;;
      fedora)
        echo "→ Fedora: installing latest Python via dnf"
        dnf install -y python3.12 python3.12-pip python3.12-devel 2>/dev/null \
          || dnf install -y python3.11 python3.11-pip python3.11-devel 2>/dev/null \
          || true
        for ver in "${PY_PREFERRED[@]}"; do
          if [[ -x "/usr/bin/python${ver}" ]]; then
            PYTHON3_BIN="/usr/bin/python${ver}"
            break
          fi
        done
        ;;
      alpine)
        apk add --no-cache python3 py3-pip
        PYTHON3_BIN="/usr/bin/python3"
        ;;
      *)
        echo "WARN: unknown distro '$DISTRO_ID' — please install Python ${PY_MIN_MAJOR}.${PY_MIN_MINOR}+ manually." >&2
        ;;
    esac
  }
  install_upgraded_python

  # Re-resolve and re-check
  PY_VER=$("$PYTHON3_BIN" -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null || echo "0.0")
  if ! version_ge_min "$PY_VER"; then
    echo "ERROR: still on Python $PY_VER after upgrade attempt. Need ${PY_MIN_MAJOR}.${PY_MIN_MINOR}+." >&2
    echo "Please install manually: sudo apt install python3.11 (Ubuntu/Debian)" >&2
    echo "                       sudo dnf module install python311 (RHEL/Rocky 8+)" >&2
    exit 1
  fi
fi

echo "  Using Python $PY_VER at $PYTHON3_BIN ✓"

# Detect distro for the right package manager
# IMPORTANT: package names below use python3.11/3.12 (matching our resolved
# PYTHON3_BIN) NOT plain python3 — so deps install for the SAME interpreter
# we'll use to run the agent. Otherwise we'd get a runtime "ImportError: No
# module named requests" because python3.X interpreter can't find the system
# python3 site-packages.
PY_MAJOR_MINOR=$(echo "$PY_VER" | tr -d '.')  # e.g. "3.11" → "311"
PY_PKG_SUFFIX="${PY_VER}"                    # e.g. "3.11"

if command -v apt >/dev/null 2>&1; then
  echo "→ Installing Python dependencies via apt (Debian/Ubuntu)"
  apt-get update -qq
  # Try versioned packages first (e.g. python3.12-requests from deadsnakes PPA).
  # Fall back to plain python3-* if versioned not available (system Python).
  if ! DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
       "python${PY_PKG_SUFFIX}-requests" \
       "python${PY_PKG_SUFFIX}-yaml" \
       "python${PY_PKG_SUFFIX}-psutil" 2>/dev/null; then
    echo "  versioned python${PY_PKG_SUFFIX}-* not in repo — falling back to python3-*"
    if ! DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
         python3-requests python3-yaml python3-psutil 2>/dev/null; then
      echo "  apt install failed — using pip as last resort"
      "$PYTHON3_BIN" -m ensurepip --upgrade 2>/dev/null || true
      "$PYTHON3_BIN" -m pip install --quiet --break-system-packages requests pyyaml psutil 2>/dev/null \
        || "$PYTHON3_BIN" -m pip install --quiet --user requests pyyaml psutil
    fi
  fi
elif command -v dnf >/dev/null 2>&1; then
  echo "→ Installing Python dependencies via dnf (RHEL/Fedora/Rocky)"
  # Try versioned packages first (e.g. python3.12-requests from dnf module),
  # fall back to plain python3-*.
  if ! dnf install -y \
       "python${PY_PKG_SUFFIX}-requests" \
       "python${PY_PKG_SUFFIX}-pyyaml" \
       "python${PY_PKG_SUFFIX}-psutil" 2>/dev/null; then
    echo "  versioned python${PY_PKG_SUFFIX}-* not in repo — falling back to python3-*"
    if ! dnf install -y \
         python3-requests \
         python3-pyyaml \
         python3-psutil 2>/dev/null; then
      echo "  dnf install failed — using pip as last resort"
      "$PYTHON3_BIN" -m ensurepip --upgrade 2>/dev/null || true
      "$PYTHON3_BIN" -m pip install --quiet --user requests pyyaml psutil
    fi
  fi
elif command -v yum >/dev/null 2>&1; then
  if [[ -f /etc/centos-release ]] && grep -q "release 7" /etc/centos-release; then
    echo "→ CentOS 7 fallback: pip install for SCL Python"
    # SCL packages were installed above; install deps via pip into SCL site-packages
    "$PYTHON3_BIN" -m pip install --quiet requests pyyaml psutil || true
  else
    echo "→ Installing Python dependencies via yum (RHEL/CentOS 8+)"
    yum install -y \
      "python${PY_PKG_SUFFIX}-requests" \
      "python${PY_PKG_SUFFIX}-pyyaml" \
      "python${PY_PKG_SUFFIX}-psutil" 2>/dev/null || \
    yum install -y \
      python3-requests \
      python3-pyyaml \
      python3-psutil 2>/dev/null || {
      echo "  yum install failed — using pip as last resort"
      "$PYTHON3_BIN" -m ensurepip --upgrade 2>/dev/null || true
      "$PYTHON3_BIN" -m pip install --quiet --user requests pyyaml psutil
    }
  fi
elif command -v apk >/dev/null 2>&1; then
  echo "→ Installing Python dependencies via apk (Alpine)"
  apk add --no-cache \
    py3-requests \
    py3-yaml \
    py3-psutil
else
  echo "ERROR: No supported package manager found (apt/dnf/yum/apk)." >&2
  echo "Please install manually: requests, PyYAML, psutil" >&2
  exit 1
fi

# Verify imports work — fail fast if a dep is missing
echo "→ Verifying Python dependencies"
"$PYTHON3_BIN" -c "import requests, yaml, psutil; print(f'  requests {requests.__version__}, yaml {yaml.__version__}, psutil {psutil.__version__} ✓')"

echo "→ Creating directories"
mkdir -p "$INSTALL_DIR" "$CONFIG_DIR" "$STATE_DIR" "$LOG_DIR"
# Ensure log/state dirs are writable by the service user
chown root:root "$INSTALL_DIR" "$STATE_DIR" "$LOG_DIR" 2>/dev/null || true
chmod 0755 "$INSTALL_DIR"
chmod 0750 "$STATE_DIR" "$LOG_DIR"

echo "→ Copying agent script"
install -m 0755 "$(dirname "$0")/agent.py" "$INSTALL_DIR/agent.py"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "→ Creating default config at $CONFIG_FILE (EDIT THIS with your credentials!)"
  install -m 0600 "$(dirname "$0")/config.example.yaml" "$CONFIG_FILE"
else
  echo "→ Config $CONFIG_FILE already exists (skipping)"
fi

echo "→ Installing hardened systemd service"
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=OpenShield Agent (Python)
Documentation=https://openshield.local
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
Group=root
# SupplementaryGroups=adm allows the agent (as root) to read group-restricted
# log files like /var/log/auth.log (mode 0640, owned by syslog:adm on Debian/Ubuntu,
# root:adm on RHEL). Combined with the empty CapabilityBoundingSet below (no
# CAP_DAC_OVERRIDE), this is the cleanest way to grant read access without
# weakening the rest of the sandbox.
SupplementaryGroups=adm
# Use the resolved python3 path (SCL on CentOS 7 may live at /usr/local/bin/python3).
ExecStart=$PYTHON3_BIN $INSTALL_DIR/agent.py -c $CONFIG_FILE -d
Restart=always
RestartSec=10
TimeoutStopSec=15
StandardOutput=journal
StandardError=journal

# Hardening (root-proof edition: dirs pre-created by installer; relaxed ProtectSystem to allow writes)
# NoNewPrivileges=false so the agent retains root privileges inside the namespace.
# CapabilityBoundingSet= stays empty on purpose: we rely on SupplementaryGroups=adm
# for log read access, avoiding CAP_DAC_OVERRIDE which would be a much wider grant.
NoNewPrivileges=false
ProtectSystem=full
ProtectHome=false
PrivateTmp=true
ReadWritePaths=$INSTALL_DIR /var/log $CONFIG_DIR $STATE_DIR $LOG_DIR
CapabilityBoundingSet=
RestrictSUIDSGID=true
LockPersonality=true
RestrictRealtime=true
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable openshield-agent.service
systemctl restart openshield-agent.service

echo ""
echo "═══════════════════════════════════════════════"
echo " ✅ OpenShield Agent is RUNNING"
echo "═══════════════════════════════════════════════"
echo " Status: systemctl status openshield-agent"
echo " Logs:   journalctl -u openshield-agent -f"
echo " Stop:   sudo systemctl stop openshield-agent"
echo "═══════════════════════════════════════════════"
sleep 1
systemctl --no-pager --full status openshield-agent.service | head -5 || true
