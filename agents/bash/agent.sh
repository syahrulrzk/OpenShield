#!/usr/bin/env bash
#
# OpenShield Bash Agent (Admin-Token Auth)
# ──────────────────────────────────────────────────────────────
# Lightweight monitoring agent for hosts where the central poller
# cannot reach (no SSH/DB credentials, firewalled, air-gapped segments,
# minimal install like Alpine/embedded).
#
# Auth model (admin-token):
#   1. Admin creates agent via OpenShield UI → gets agentId + secretToken
#   2. Copy credentials into /etc/openshield/agent.json
#   3. Agent starts → first heartbeat authenticates → status ONLINE
#   4. No separate /register call needed (admin already pre-registered)
#
# Features:
#   - Tail-mode log monitoring (auth.log, syslog, app logs, nginx, etc.)
#   - Regex-based event classification (sshd, sudo, login, custom)
#   - Buffered batch send (default: 30s heartbeat, 100 events/batch)
#   - Auto-reconnect on network failure
#   - systemd-friendly (graceful shutdown on SIGTERM)
#
# Zero external deps: bash 4+, coreutils, openssl (for HMAC).
# Optional: jq (for JSON construction — falls back to printf).
#
# Installation:
#   1. Admin creates agent via UI → gets agentId + secretToken
#   2. Copy credentials to /etc/openshield/agent.json
#   3. Run: sudo ./install.sh (creates systemd service)
#   4. Verify: systemctl status openshield-agent
#
# Config file: /etc/openshield/agent.json (or path passed via -c)
# State file:  /var/lib/openshield/agent.state (auto-created on register)

set +u
# NOTE: not using `set -e` because we want the agent to keep running
# even when individual log reads / sends fail.
# NOTE: not using `set -u` because some vars are populated lazily
# (secret/agent_id only after load_state() runs).

VERSION="1.0.0"

# ─── Defaults ────────────────────────────────────────────────
SERVER_URL="${OPENSHIELD_SERVER_URL:-http://127.0.0.1:3001}"
AGENT_ID_VAR="${OPENSHIELD_AGENT_ID:-}"
SECRET_TOKEN_VAR="${OPENSHIELD_SECRET_TOKEN:-}"
AGENT_NAME="${OPENSHIELD_AGENT_NAME:-$(uname -n 2>/dev/null || hostname)}"
HEARTBEAT_INTERVAL="${OPENSHIELD_HEARTBEAT_INTERVAL:-30}"
EVENT_BATCH_SIZE="${OPENSHIELD_EVENT_BATCH_SIZE:-100}"
STATE_DIR="${OPENSHIELD_STATE_DIR:-/var/lib/openshield}"
LOG_DIR="${OPENSHIELD_LOG_DIR:-/var/log/openshield}"
CONFIG_FILE=""
DEBUG=0

# ─── Paths ───────────────────────────────────────────────────
mkdir -p "$STATE_DIR" "$LOG_DIR" 2>/dev/null || {
  echo "[FATAL] cannot create state/log dirs ($STATE_DIR, $LOG_DIR). Run as root or set OPENSHIELD_STATE_DIR." >&2
  exit 1
}
STATE_FILE="$STATE_DIR/agent.state"
LOG_FILE="$LOG_DIR/agent.log"

# ─── Logging ─────────────────────────────────────────────────
log() {
  local level="$1"; shift
  local ts; ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  printf '[%s] [%s] %s\n' "$ts" "$level" "$*" | tee -a "$LOG_FILE" >&2
}
debug() { [[ $DEBUG -eq 1 ]] && log DEBUG "$*"; return 0; }
info()  { log INFO  "$*"; }
warn()  { log WARN  "$*"; }
err()   { log ERROR "$*"; }
die()   { err "$*"; exit 1; }

# ─── Usage ───────────────────────────────────────────────────
usage() {
  cat <<EOF
OpenShield Bash Agent v$VERSION (admin-token auth)

Usage: $0 [options]

Options:
  -c FILE     Config file path (default: /etc/openshield/agent.json)
  -d          Enable debug logging
  -h          Show this help

Environment variables (override config):
  OPENSHIELD_SERVER_URL         e.g. http://10.0.0.5:3001
  OPENSHIELD_AGENT_ID           from OpenShield UI ("Add Agent" → credentials)
  OPENSHIELD_SECRET_TOKEN       from OpenShield UI (shown ONCE)
  OPENSHIELD_AGENT_NAME         human-readable name (default: hostname)
  OPENSHIELD_HEARTBEAT_INTERVAL seconds (default: 30)
  OPENSHIELD_EVENT_BATCH_SIZE   max events per heartbeat (default: 100)
  OPENSHIELD_STATE_DIR          where to persist state (default: /var/lib/openshield)
  OPENSHIELD_LOG_DIR            where to write agent.log (default: /var/log/openshield)
EOF
}

# ─── Config ──────────────────────────────────────────────────
load_config() {
  if [[ -n "$CONFIG_FILE" && -r "$CONFIG_FILE" ]]; then
    info "Loading config from $CONFIG_FILE"
    # Map lowercase keys → uppercase env-style names for consistency.
    if command -v jq >/dev/null 2>&1; then
      eval "$(jq -r 'to_entries | .[] | "local_\(.key | ascii_upcase)=\(.value | tostring | @sh)"' "$CONFIG_FILE" 2>/dev/null)"
    else
      while IFS='=' read -r key value; do
        key=$(echo "$key" | tr -d ' ,"')
        value=$(echo "$value" | sed 's/^"//; s/"$//; s/,$//')
        [[ -n "$key" && -n "$value" ]] && printf 'local_%s=%q\n' "$(echo "$key" | tr '[:lower:]' '[:upper:]')" "$value"
      done < <(grep -oE '"[a-z_]+"\s*:\s*("[^"]*"|[0-9.]+)' "$CONFIG_FILE")
    fi
    [[ -n "${local_SERVER_URL:-}" ]]          && SERVER_URL="$local_SERVER_URL"
    [[ -n "${local_AGENT_ID:-}" ]]           && AGENT_ID_VAR="$local_AGENT_ID"
    [[ -n "${local_SECRET_TOKEN:-}" ]]       && SECRET_TOKEN_VAR="$local_SECRET_TOKEN"
    [[ -n "${local_AGENT_NAME:-}" ]]         && AGENT_NAME="$local_AGENT_NAME"
    [[ -n "${local_HEARTBEAT_INTERVAL:-}" ]] && HEARTBEAT_INTERVAL="$local_HEARTBEAT_INTERVAL"
    [[ -n "${local_EVENT_BATCH_SIZE:-}" ]]   && EVENT_BATCH_SIZE="$local_EVENT_BATCH_SIZE"
  fi
  [[ -z "$AGENT_ID_VAR" ]]     && die "AGENT_ID not set. Use OPENSHIELD_AGENT_ID env or -c config."
  [[ -z "$SECRET_TOKEN_VAR" ]] && die "SECRET_TOKEN not set. Use OPENSHIELD_SECRET_TOKEN env or -c config."
  [[ -z "$SERVER_URL" ]]       && die "SERVER_URL not set."
}

# ─── State persistence ──────────────────────────────────────
save_state() {
  cat > "$STATE_FILE" <<EOF
agent_id=$1
last_seen=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
EOF
  chmod 600 "$STATE_FILE"
}

load_state() {
  if [[ -r "$STATE_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$STATE_FILE"
    [[ -n "${agent_id:-}" ]]
  else
    return 1
  fi
}

# ─── HMAC signing (matches server's hmac.ts) ────────────────
hmac_sha256() {
  local secret="$1" body="$2"
  printf '%s' "$body" | openssl dgst -sha256 -hmac "$secret" -hex | awk '{print "sha256=" $NF}'
}

# ─── JSON helpers ───────────────────────────────────────────
json_escape() {
  local s="$1"
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/\\r}
  s=${s//$'\t'/\\t}
  printf '%s' "$s"
}

if command -v jq >/dev/null 2>&1; then
  HAS_JQ=1
else
  HAS_JQ=0
  warn "jq not found, falling back to printf-based JSON (less safe for unusual chars)"
fi

# ─── Detect host info ───────────────────────────────────────
detect_host() {
  HOSTNAME_VAL=$(hostname -f 2>/dev/null || hostname 2>/dev/null || echo "unknown")
  OS_DESC=$(uname -srm 2>/dev/null || echo "unknown")
  KERNEL=$(uname -r 2>/dev/null || echo "")
  IP_VAL=$(timeout 3 curl -s -4 https://api.ipify.org 2>/dev/null || \
           timeout 3 curl -s -4 ifconfig.me 2>/dev/null || \
           hostname -I 2>/dev/null | awk '{print $1}' || \
           echo "0.0.0.0")
}

# ─── Log tailing state ──────────────────────────────────────
declare -A LOG_OFFSETS
load_offsets() {
  local offsets_dir="$STATE_DIR/offsets"
  mkdir -p "$offsets_dir"
  for f in "$offsets_dir"/*.offset; do
    [[ -r "$f" ]] || continue
    local name; name=$(basename "$f" .offset)
    LOG_OFFSETS["$name"]=$(cat "$f")
  done
}
save_offset() {
  local name="$1" offset="$2"
  echo "$offset" > "$STATE_DIR/offsets/${name}.offset"
}

# ─── Event buffer ──────────────────────────────────────────
EVENT_BUFFER=""
EVENT_COUNT=0

buffer_event() {
  local eventType="$1" severity="$2" source="$3" message="$4" rawData="$5"
  local evt
  if [[ $HAS_JQ -eq 1 ]]; then
    evt=$(jq -nc \
      --arg et "$eventType" --arg sv "$severity" --arg sr "$source" \
      --arg ms "$message" --argjson rd "${rawData:-null}" \
      --arg ts "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
      '{eventType: $et, severity: $sv, source: $sr, message: $ms, rawData: $rd, eventTime: $ts}')
  else
    evt=$(printf '{"eventType":"%s","severity":"%s","source":"%s","message":"%s","rawData":%s,"eventTime":"%s"}' \
      "$(json_escape "$eventType")" \
      "$(json_escape "$severity")" \
      "$(json_escape "$source")" \
      "$(json_escape "$message")" \
      "${rawData:-null}" \
      "$(date -u +"%Y-%m-%dT%H:%M:%SZ")")
  fi

  if [[ $HAS_JQ -eq 1 ]] && ! echo "$evt" | jq -e . >/dev/null 2>&1; then
    err "buffer_event: invalid event JSON, skipping: $evt"
    return 1
  fi

  if [[ -z "$EVENT_BUFFER" ]]; then
    EVENT_BUFFER="$evt"
  else
    EVENT_BUFFER="${EVENT_BUFFER},${evt}"
  fi
  EVENT_COUNT=$((EVENT_COUNT + 1))
  debug "Buffered event #$EVENT_COUNT (buf_len=${#EVENT_BUFFER}): ${evt:0:100}..."
}

flush_events() {
  local events_part
  if [[ $EVENT_COUNT -eq 0 ]]; then
    events_part="[]"
  else
    events_part="[${EVENT_BUFFER}]"
  fi
  if [[ $HAS_JQ -eq 1 ]] && ! echo "$events_part" | jq -e . >/dev/null 2>&1; then
    err "Malformed events JSON, dropping buffer: $events_part"
    EVENT_BUFFER=""
    EVENT_COUNT=0
    return 1
  fi

  local body
  if [[ $HAS_JQ -eq 1 ]]; then
    body=$(jq -nc \
      --arg v "$VERSION" \
      --argjson e "$events_part" \
      --arg hn "$HOSTNAME_VAL" \
      --arg ip "$IP_VAL" \
      --arg os "$OS_DESC" \
      --arg kr "$KERNEL" \
      '{version: $v, events: $e, identity: {hostname: $hn, ip: $ip, os: $os, kernel: $kr}}')
  else
    body="{\"version\":\"$(json_escape "$VERSION")\",\"events\":${events_part},\"identity\":{\"hostname\":\"$(json_escape "$HOSTNAME_VAL")\",\"ip\":\"$(json_escape "$IP_VAL")\",\"os\":\"$(json_escape "$OS_DESC")\",\"kernel\":\"$(json_escape "$KERNEL")\"}}"
  fi

  local sig
  sig=$(hmac_sha256 "$SECRET_TOKEN_VAR" "$body")

  debug "Sending heartbeat: events=$EVENT_COUNT body_bytes=${#body}"
  local resp
  resp=$(curl --max-time 10 -fsS -X POST "$SERVER_URL/api/agents/heartbeat" \
    -H "Content-Type: application/json" \
    -H "X-Openshield-Agent-Id: $AGENT_ID_VAR" \
    -H "X-Openshield-Agent-Signature: $sig" \
    -d "$body" 2>&1) || { warn "Heartbeat failed: [code=$?] agent_id=$AGENT_ID_VAR resp='$resp'"; return 1; }

  if [[ $HAS_JQ -eq 1 ]]; then
    local stats; stats=$(echo "$resp" | jq -c '.stats // {}')
    debug "Heartbeat OK (events=$EVENT_COUNT) — stats=$stats"
  fi
  save_state "$AGENT_ID_VAR"
  EVENT_BUFFER=""
  EVENT_COUNT=0
  return 0
}

# ─── Tail log file once ────────────────────────────────────
tail_log() {
  local path="$1" parser="$2"
  [[ -r "$path" ]] || { debug "Skip $path (not readable)"; return 0; }

  local name; name=$(basename "$path")
  local size; size=$(stat -c%s "$path" 2>/dev/null || stat -f%z "$path" 2>/dev/null || echo 0)
  local last="${LOG_OFFSETS[$name]:-0}"

  if (( size < last )); then
    debug "Log rotated: $path (was $last, now $size)"
    last=0
  fi

  if (( size > last )); then
    local chunk; chunk=$(dd if="$path" bs=1 skip="$last" count=$((size - last)) 2>/dev/null)
    while IFS= read -r line; do
      parse_log_line "$parser" "$path" "$line"
    done <<< "$chunk"
    save_offset "$name" "$size"
    LOG_OFFSETS["$name"]="$size"
  fi
}

# ─── Parse log lines into events ──────────────────────────
parse_log_line() {
  local parser="$1" path="$2" line="$3"
  [[ -z "$line" ]] && return 0

  case "$parser" in
    sshd)
      if [[ "$line" =~ Accepted\ (publickey|password)\ for\ ([^[:space:]]+)\ from\ ([^[:space:]]+)\ port\ [0-9]+ ]]; then
        local method="${BASH_REMATCH[1]}" user="${BASH_REMATCH[2]}" ip="${BASH_REMATCH[3]}"
        buffer_event "log.line" "INFO" "$path" \
          "SSH login OK ($method) for $user from $ip" \
          "{\"user\":\"$user\",\"ip\":\"$ip\",\"method\":\"$method\"}"
      elif [[ "$line" =~ Failed\ password\ for\ (invalid\ user\ )?([^[:space:]]+)\ from\ ([^[:space:]]+)\ port\ [0-9]+ ]]; then
        local invalid="${BASH_REMATCH[1]:-}" user="${BASH_REMATCH[2]}" ip="${BASH_REMATCH[3]}"
        local sev="WARN"; [[ -n "$invalid" ]] && sev="ERROR"
        local invalid_json="false"; [[ -n "$invalid" ]] && invalid_json="true"
        buffer_event "log.line" "$sev" "$path" \
          "SSH login failed for $user from $ip" \
          "{\"user\":\"$user\",\"ip\":\"$ip\",\"invalid\":$invalid_json}"
      elif [[ "$line" =~ Invalid\ user\ ([^[:space:]]+)\ from\ ([^[:space:]]+) ]]; then
        local user="${BASH_REMATCH[1]}" ip="${BASH_REMATCH[2]}"
        buffer_event "log.line" "ERROR" "$path" \
          "SSH invalid user: $user from $ip" \
          "{\"user\":\"$user\",\"ip\":\"$ip\"}"
      fi
      ;;
    sudo)
      local sudo_auth_re='pam_unix\(sudo:auth\):[[:space:]]authentication[[:space:]]failure'
      local sudo_cmd_re='sudo:[[:space:]]+([^[:space:]]+)[[:space:]]+:[[:space:]]+TTY=([^[:space:]]+)[[:space:]]+;[[:space:]]*PWD=([^[:space:]]+)[[:space:]]+;[[:space:]]*USER=([^[:space:]]+)[[:space:]]+;[[:space:]]*COMMAND=(.+)'
      if [[ "$line" =~ $sudo_auth_re ]]; then
        local user; user=$(echo "$line" | grep -oP 'ruser=\K[^ ]+' | head -1)
        user="${user:-unknown}"
        buffer_event "log.line" "WARN" "$path" \
          "sudo authentication failure for $user" \
          "{\"user\":\"$user\"}"
      elif [[ "$line" =~ $sudo_cmd_re ]]; then
        local admin="${BASH_REMATCH[1]}" target="${BASH_REMATCH[4]}" cmd="${BASH_REMATCH[5]}"
        buffer_event "log.line" "INFO" "$path" \
          "sudo: $admin ran '$cmd' as $target" \
          "{\"admin\":\"$admin\",\"target\":\"$target\",\"command\":\"$cmd\"}"
      fi
      ;;
    syslog)
      buffer_event "log.line" "INFO" "$path" "$line" "null"
      ;;
    nginx)
      if [[ "$line" =~ '^([^[:space:]]+)\ .+\ "[^"]+"\ ([0-9]+)\ [0-9]+' ]]; then
        local ip="${BASH_REMATCH[1]}" status="${BASH_REMATCH[2]}"
        local sev="INFO"
        (( status >= 500 )) && sev="ERROR"
        (( status >= 400 && status < 500 )) && sev="WARN"
        buffer_event "log.line" "$sev" "$path" \
          "nginx $status from $ip" \
          "{\"ip\":\"$ip\",\"status\":$status}"
      fi
      ;;
    *)
      buffer_event "log.line" "INFO" "$path" "$line" "null"
      ;;
  esac
}

# ─── Main loop ─────────────────────────────────────────────
main_loop() {
  local logs=(
    "/var/log/auth.log:sshd"
    "/var/log/syslog:syslog"
    "/var/log/secure:sshd"
  )

  if [[ -n "${local_LOG_PATHS:-}" && $HAS_JQ -eq 1 ]]; then
    logs=()
    while IFS=$'\t' read -r path parser; do
      [[ -n "$path" ]] && logs+=("$path:$parser")
    done < <(echo "$local_LOG_PATHS" | jq -r '.[] | "\(.path)\t\(.parser // "syslog")"')
  fi

  info "Starting main loop (heartbeat=${HEARTBEAT_INTERVAL}s, batch=${EVENT_BATCH_SIZE})"
  info "Agent ID: $AGENT_ID_VAR"
  info "Monitoring ${#logs[@]} log sources"

  while true; do
    for entry in "${logs[@]}"; do
      local path="${entry%%:*}"
      local parser="${entry##*:}"
      tail_log "$path" "$parser" || true
      (( EVENT_COUNT >= EVENT_BATCH_SIZE )) && flush_events
    done

    flush_events

    sleep "$HEARTBEAT_INTERVAL" &
    wait $!
  done
}

# ─── Signal handlers ──────────────────────────────────────
cleanup() {
  info "Shutting down (SIGTERM/SIGINT)..."
  flush_events || true
  exit 0
}
trap cleanup SIGTERM SIGINT

# ─── Entry point ──────────────────────────────────────────
while getopts "c:dh" opt; do
  case $opt in
    c) CONFIG_FILE="$OPTARG" ;;
    d) DEBUG=1 ;;
    h) usage; exit 0 ;;
    *) usage; exit 1 ;;
  esac
done

detect_host
load_config
load_offsets

# Verify agent_id matches (optional sanity check)
if load_state 2>/dev/null && [[ -n "${agent_id:-}" && "${agent_id}" != "$AGENT_ID_VAR" ]]; then
  warn "Agent ID in state file ($agent_id) differs from config ($AGENT_ID_VAR). Using config value."
fi

info "Agent authenticated as: $AGENT_NAME ($AGENT_ID_VAR)"
main_loop
