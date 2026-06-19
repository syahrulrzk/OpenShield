# OpenShield Agents

Two agent implementations for host-based monitoring that **complement** the central poller (Phase A). Use agents when:
- You can't SSH into a host (firewalled, no creds)
- You need deeper coverage (file integrity, process anomalies)
- The host is air-gapped / minimal install (Alpine, embedded)

---

## Quick Start (TL;DR)

### 1. Add Agent in UI
1. Login as OWNER/ADMIN
2. Go to **Settings → Agents → Add Agent**
3. Fill in name (e.g. `prod-web-jkt-01`), pick type (BASH or PYTHON)
4. Click **Create Agent**
5. **Copy the token** — shown ONCE, can't be recovered

### 2. Install on the Host

#### Bash Agent (lightweight, no deps)
```bash
sudo bash install.sh
sudo vi /etc/openshield/agent.json   # paste agent_id + secret_token
sudo systemctl restart openshield-agent
sudo systemctl status openshield-agent
```

#### Python Agent (full features, needs Python 3.8+)
```bash
sudo bash install.sh
sudo vi /etc/openshield/agent.yaml   # paste agent_id + secret_token
sudo systemctl restart openshield-agent
sudo systemctl status openshield-agent
```

### 3. Verify in OpenShield UI
- Settings → Agents → your agent row should show **ONLINE** within 30s
- Events will appear under the agent's row

---

## Bash Agent (`bash/`)

**Zero external dependencies** — bash 4+, coreutils, openssl, curl. Optional `jq` for safer JSON.

### What it does
- **Tail-mode log monitoring** with offset tracking (handles log rotation)
- 5 built-in parsers:
  - `sshd` — Accepted/Failed/Invalid user from auth.log
  - `sudo` — auth failure + privilege escalation
  - `syslog` — generic INFO-level raw
  - `nginx` — status code classification
  - `generic` — fallback raw
- **Buffered batch sends** (default: 30s heartbeat, 100 events/batch)
- **Self-restart on failure** via systemd

### Configuration
```json
{
  "server_url": "http://openshield.example.com:3001",
  "agent_id": "cmq...",
  "secret_token": "os_agt_...",
  "agent_name": "my-host",
  "heartbeat_interval": 30,
  "event_batch_size": 100,
  "log_paths": [
    {"path": "/var/log/auth.log", "parser": "sshd"},
    {"path": "/var/log/syslog", "parser": "syslog"}
  ]
}
```

Config can also be set via env vars:
```bash
export OPENSHIELD_SERVER_URL=http://...
export OPENSHIELD_AGENT_ID=cmq...
export OPENSHIELD_SECRET_TOKEN=os_agt_...
```

---

## Python Agent (`python/`)

**Full-featured** — requires Python 3.8+, requests, PyYAML, psutil (recommended).

### What it does (everything Bash does, plus)
- **File Integrity Monitoring (FIM)**: SHA-256 baseline on critical paths,
  alerts on any hash change (`/etc/passwd`, `/etc/shadow`, sudoers, sshd_config, etc.)
- **Process anomaly detection**: regex watchlist for suspicious patterns
  (web server → shell, xmrig/cryptominers, reverse shells with `nc -e`)
- **System metrics**: CPU%, RAM%, disk%, load avg (via psutil)
- Pluggable design — easy to extend with custom event sources

### Configuration
```yaml
server_url: "http://openshield.example.com:3001"
agent_id: "cmq..."
secret_token: "os_agt_..."
agent_name: "my-host"

heartbeat_interval: 30
event_batch_size: 100

# File Integrity Monitoring
fim_paths:
  - /etc/passwd
  - /etc/shadow
  - /etc/sudoers
  - /etc/ssh/sshd_config

# Process watchlist (regex patterns)
process_watchlist:
  - '^(www-data|nginx|apache) .* (/bin/(ba)?sh)$'
  - '(xmrig|cryptonight|stratum\+tcp)'
  - '(nc|ncat|netcat)\s.*-e\s'
```

---

## Architecture

```
┌─────────────────────────────────┐         ┌──────────────────────┐
│  OpenShield Server (Next.js)    │         │  Monitored Host      │
│  ┌───────────────────────────┐  │  HTTPS  │  ┌────────────────┐  │
│  │ /api/agents (POST)        │◄─┼─────────┼──┤  UI: Add Agent │  │
│  │  → generate agent_id      │  │  token  │  │  → get token   │  │
│  │  → generate secret_token  │  │         │  └────────────────┘  │
│  └───────────────────────────┘  │         │           │          │
│  ┌───────────────────────────┐  │         │           ▼          │
│  │ /api/agents/[id]/heartbeat│◄─┼─────────┼──┐  ┌──────────────┐ │
│  │  → verify HMAC signature  │  │  HMAC   │  └──┤  Agent       │ │
│  │  → insert events          │  │  every  │     │  (Bash/Py)   │ │
│  │  → update status          │  │   30s   │     └──────────────┘ │
│  └───────────────────────────┘  │         │                      │
└─────────────────────────────────┘         └──────────────────────┘
```

## Security

### Auth model
- **Bootstrap**: Admin creates agent via UI → gets `agent_id` + `secret_token` (shown ONCE)
- **Runtime**: HMAC-SHA256 signature on every heartbeat using `secret_token`
- **Token rotation**: UI button generates new token, old token immediately invalid

### Hardening
- Token is **64-char hex** (256-bit entropy)
- AES-256-GCM encrypted at rest in DB
- Timing-safe HMAC comparison
- `NoNewPrivileges`, `ProtectSystem=strict`, `PrivateTmp` in systemd unit
- Rate-limited via `/api/agents/heartbeat` audit logging
- All actions logged to audit log: `agent.created`, `agent.token.rotated`, `agent.revoked`

### Threat model
- ✅ Compromised agent token → admin rotates from UI (old token invalid)
- ✅ Agent host compromised → revoke agent from UI (status=REVOKED, heartbeat rejected)
- ✅ Token leak in transit → TLS (deploy behind reverse proxy with cert)
- ⚠️ Server compromise → tokens decryptable, rotate ALL agents immediately
- ⚠️ MITM → ensure TLS termination (use `https://` in `server_url`)

---

## Operations

### Rotate token (lost local config / suspected compromise)
1. UI → Settings → Agents → click 🔄 icon → confirm
2. New token shown ONCE → copy
3. Update `/etc/openshield/agent.json` (or `.yaml`) on host
4. `sudo systemctl restart openshield-agent`
5. Verify status returns to ONLINE within 30s

### Revoke agent (decommission / permanently disable)
1. UI → Settings → Agents → click 🗑️ icon → confirm
2. Agent's next heartbeat is rejected with `agent_revoked`
3. Agent row stays in DB for audit (status=REVOKED, revokedAt=timestamp)

### Re-activate revoked agent
- Use **Rotate Token** button (also re-activates)

### Check status from CLI
```bash
# Bash agent
sudo systemctl status openshield-agent
sudo journalctl -u openshield-agent -f
sudo tail -f /var/log/openshield/agent.log

# Python agent (same paths)
sudo systemctl status openshield-agent
sudo journalctl -u openshield-agent -f
sudo tail -f /var/log/openshield/agent.log
```

### Test from CLI (no UI needed)
```bash
# Replay a test event directly
curl -X POST http://YOUR-SERVER:3001/api/agents/heartbeat \
  -H "Content-Type: application/json" \
  -H "X-Openshield-Agent-Id: cmq..." \
  -H "X-Openshield-Agent-Signature: sha256=$(echo -n '{"version":"1.0.0","events":[]}' | openssl dgst -sha256 -hmac "os_agt_..." -hex | awk '{print "sha256=" $NF}')" \
  -d '{"version":"1.0.0","events":[]}'
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Status stays REGISTERED | Agent never heartbeated | Check `systemctl status`, view logs, verify network reachability |
| Status OFFLINE | Last heartbeat > 10 min ago | Check `journalctl` for crash, increase heartbeat interval |
| Status ERROR | Last heartbeat returned 4xx/5xx | Run agent with `-d` (bash) or check Python logs |
| `signature_mismatch` in logs | Wrong secret_token in config | Re-paste from UI (use Rotate Token if old one is lost) |
| `unknown_agent` | agent_id in config doesn't exist | Verify in UI; create new agent if needed |
| `agent_revoked` | Agent was revoked from UI | Rotate token to re-activate |
| Duplicate events | Two agents on same host with overlapping log paths | Set different `log_paths` per agent, or disable one |

---

## Files

```
agents/
├── bash/
│   ├── agent.sh              # Bash agent (no deps)
│   ├── config.example.json   # Config template
│   └── install.sh            # systemd installer
├── python/
│   ├── agent.py              # Python agent (full features)
│   ├── config.example.yaml   # Config template
│   ├── requirements.txt      # pip deps
│   └── install.sh            # systemd installer
└── README.md                 # this file
```
