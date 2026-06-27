# 🛡️ OpenShield

> **Self-hosted, security-first observability for Linux servers & databases.**
> Detect unauthorized access attempts — without enterprise SIEM prices or shipping data to the cloud.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0-green.svg)]()
[![Next.js](https://img.shields.io/badge/Next.js-16.2.9-black)](https://nextjs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue)](https://www.postgresql.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

OpenShield is a **self-hosted security monitoring dashboard** built for small-to-mid infrastructure teams (5–100 hosts) who need to:

- 🔍 Detect SSH brute-force & credential-stuffing attacks
- 🗄️ Monitor database login attempts (PostgreSQL, MySQL, SQL Server)
- 📊 Track file integrity changes (FIM) on critical paths
- 📱 Monitor third-party apps login events (via API integration)
- 📜 Maintain tamper-evident audit logs for compliance
- 🚨 Get real-time alerts on suspicious activity

**All your data stays on your infrastructure. No cloud, no SaaS, no surprises.**

---

## 📑 Table of Contents

1. [Why OpenShield?](#-why-openshield)
2. [Features](#-features)
3. [Architecture](#-architecture)
4. [Tech Stack](#-tech-stack)
5. [Quick Start](#-quick-start)
6. [Installation Progress](#-installation-progress)
7. [Configuration](#-configuration)
8. [Use Cases](#-use-cases)
9. [Development](#-development)
10. [Roadmap](#-roadmap)
11. [Contributing](#-contributing)
12. [License](#-license)

---

## 🎯 Why OpenShield?

### The Problem

Small infrastructure teams running Linux servers and databases face a recurring security gap:

| Pain Point | Why It's Hard |
|------------|---------------|
| **No visibility into who's trying to log in** | Logs scattered across `/var/log/auth.log`, `pg_log`, `mysqld.log` — different formats, different hosts |
| **Brute-force attacks go unnoticed** | Until damage is done (compromised credentials, ransomware) |
| **Enterprise SIEMs are overkill** | Splunk / Elastic / Datadog = $$$$ + cloud-only + complex setup |
| **Compliance requirements** | SOC 2, ISO 27001, internal audit need tamper-evident trails |
| **Privacy concerns** | Can't ship auth logs to third-party clouds (GDPR, data residency) |

### The Solution

**OpenShield** is a focused, single-stack tool that:

- ✅ Pulls SSH + DB + syslog + FIM events into **one queryable place**
- ✅ Surfaces **real-time alerts** when something looks off
- ✅ Stores everything in a **tamper-evident, exportable audit log**
- ✅ **Self-hosted** via Docker Compose (one command to deploy)
- ✅ **Open source** under MIT license
- ✅ **Credential isolation** — plaintext SSH keys / DB passwords never leave the server

---

## ✨ Features

### 🔐 Authentication Monitoring

| Feature | Description |
|---------|-------------|
| **SSH Login Tracking** | Detect successful/failed/invalid user attempts across N servers |
| **Database Login Monitoring** | PostgreSQL, MySQL/MariaDB, SQL Server auth events |
| **Sudo & Privilege Escalation** | Track `sudo` invocations, `su` attempts, failed auth |
| **Third-Party App Monitoring** | Track login events from your apps via API integration |
| **GeoIP Enrichment** | Map source IPs to country/city (planned v0.2) |
| **Brute-Force Detection** | Alert on repeated failures from same IP/user |

### 📊 Real-Time Dashboard

- **Live event feed** via Socket.IO (no polling)
- **Interactive charts** — events by severity, top attackers, timeline
- **Advanced search** — `field:value` syntax, time ranges, severity filters
- **Agent health monitoring** — ONLINE / OFFLINE / ERROR / REVOKED
- **Asset inventory** — all monitored servers & databases in one table

### 🛡️ File Integrity Monitoring (FIM)

- **SHA-256 baseline** on critical paths (`/etc/passwd`, `/etc/shadow`, sudoers, sshd_config)
- **Change detection** — alerts on any modification
- **Baseline comparison** — track who/what/when changed

### 🗄️ Database Audit (Login Only — Lightweight)

- **Connection tracking** — Connect/Disconnect events
- **Failed authentication** — wrong password, locked accounts
- **No query capture** — privacy-first (only metadata, no SQL body)
- **Encrypted credentials** — AES-256-GCM at rest

### 🔒 Security & Compliance

| Feature | Implementation |
|---------|---------------|
| **Password hashing** | Argon2id (memory-hard, GPU-resistant) |
| **Token auth** | JWT + refresh token rotation |
| **MFA** | TOTP (planned v0.2 UI flow) |
| **RBAC** | OWNER / ADMIN / VIEWER roles |
| **Audit log** | Hash-chained (tamper-evident), exportable |
| **Encrypted credentials** | AES-256-GCM, key in env |
| **HMAC agent auth** | SHA-256 signed heartbeats |
| **Rate limiting** | Login (5/min), heartbeat abuse detection |
| **Security headers** | CSP, HSTS, X-Frame-Options |
| **Standards** | OWASP Top 10:2021 + API:2023 + ASVS 4.0.3 L1+L2 |

### 🚨 Alerts & Notifications

- **Real-time alerts** in dashboard
- **Severity levels** — CRITICAL / ERROR / WARN / INFO
- **Channels** — Webhook / Slack / Telegram (planned v0.2)

---

## 🏗️ Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────┐
│                  OpenShield Dashboard                        │
│                  (Next.js 16 + React 19)                     │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │  Dashboard │  │  Agents    │  │  Database  │            │
│  │  Events    │  │  Endpoint  │  │  Assets    │            │
│  └────────────┘  └────────────┘  └────────────┘            │
│         │               │               │                    │
│         └───────────────┴───────────────┘                    │
│                         │                                    │
│                  Socket.IO Live Feed                         │
└─────────────────────────┬───────────────────────────────────┘
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
   ┌──────────────────┐    ┌──────────────────┐
   │  /api/agents/*   │    │  /api/assets/*   │
   │  (HMAC auth)     │    │  (JWT auth)      │
   └────────┬─────────┘    └────────┬─────────┘
            │                       │
            │              ┌────────┴─────────┐
            │              ▼                  ▼
            │     ┌─────────────┐    ┌─────────────┐
            │     │   Poller    │    │   Auditd    │
            │     │   (SSH/DB)  │    │   Reader    │
            │     └──────┬──────┘    └──────┬──────┘
            │            │                  │
            └────────────┴──────────────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │     PostgreSQL 16    │
              │  ┌────────────────┐  │
              │  │ AgentEvent     │  │ ← All events
              │  │ (partitioned)  │  │
              │  └────────────────┘  │
              │  ┌────────────────┐  │
              │  │ AuditLog       │  │ ← Tamper-evident
              │  │ (hash-chained) │  │
              │  └────────────────┘  │
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │       Redis 7        │
              │  (cache + queue)     │
              └──────────────────────┘


   ┌─────────────────────────────────────────────┐
   │         Monitored Host (Agent)              │
   │  ┌──────────────┐  ┌──────────────┐         │
   │  │ Bash Agent   │  │ Python Agent │         │
   │  │ (zero deps)  │  │ (full feat)  │         │
   │  └──────┬───────┘  └──────┬───────┘         │
   │         │                 │                 │
   │    /var/log/auth.log  File Integrity        │
   │    /var/log/syslog    Process watchlist     │
   │    sudo logs          System metrics        │
   └─────────────────────────────────────────────┘
```

### Component Breakdown

| Component | Role | Tech |
|-----------|------|------|
| **Web Dashboard** | UI for events, agents, alerts, settings | Next.js 16 + React 19 + Tailwind CSS 4 |
| **API Server** | REST endpoints + Socket.IO live feed | Next.js API Routes |
| **Agent Endpoint Manager** | Generate agent_id + secret_token, heartbeat receiver | Built-in |
| **Database Poller** | Outbound SSH/DB connections to collect auth events | ssh2 + pg + mysql2 + mssql |
| **Agent (Bash)** | Lightweight log tail + batch send | Bash 4+, coreutils, curl |
| **Agent (Python)** | Full-featured: FIM, process watch, system metrics | Python 3.11+ |
| **PostgreSQL** | Primary store: events, users, assets, audit log | PostgreSQL 16 |
| **Redis** | Cache, session, BullMQ queue, rate limiting | Redis 7 |

---

## 🧰 Tech Stack

### Frontend

| Tech | Version | Purpose |
|------|---------|---------|
| **Next.js** | 16.2.9 | React framework with App Router + Turbopack |
| **React** | 19.2.4 | UI library |
| **TypeScript** | 5.x | Type safety |
| **Tailwind CSS** | 4.x | Utility-first styling |
| **Radix UI** | Latest | Accessible primitives (dialogs, dropdowns, tabs) |
| **Framer Motion** | 12.x | Animations |
| **Recharts** | 3.x | Charts (line, bar, pie) |
| **Socket.IO Client** | 4.8.x | Real-time event streaming |
| **Lucide React** | 1.x | Icon library |
| **Sonner** | 2.x | Toast notifications |

### Backend

| Tech | Version | Purpose |
|------|---------|---------|
| **Next.js API Routes** | 16.2.9 | REST endpoints |
| **Prisma** | 6.19.3 | ORM + migrations |
| **Socket.IO** | 4.8.3 | WebSocket server |
| **BullMQ** | 5.x | Background job queue |
| **ioredis** | 5.x | Redis client |
| **Argon2** | 0.44.0 | Password hashing |
| **jose** | 6.x | JWT signing/verification |
| **ssh2** | 1.17.0 | SSH client for polling |
| **pg / mysql2 / mssql** | Latest | Database drivers |

### Database & Cache

| Tech | Version | Purpose |
|------|---------|---------|
| **PostgreSQL** | 16-alpine | Primary data store |
| **Redis** | 7-alpine | Cache + queue + sessions |

### Agent (Monitored Hosts)

| Tech | Version | Purpose |
|------|---------|---------|
| **Bash** | 4+ | Lightweight agent (zero deps) |
| **Python** | 3.11+ (3.12 recommended) | Full-featured agent |
| **psutil** | Latest | System metrics (Python agent) |
| **PyYAML** | Latest | Config parsing |

### DevOps & Tooling

| Tech | Purpose |
|------|---------|
| **Docker Compose** | Single-command deployment |
| **ESLint** | Linting |
| **Husky + lint-staged** | Pre-commit hooks |
| **PM2** (optional) | Multi-core production deployment |
| **Turbopack** | Next.js dev mode (10x faster HMR) |

---

## 🚀 Quick Start

### Prerequisites

- **Docker** 24+ & **Docker Compose** v2+
- **2 CPU cores, 4 GB RAM** minimum (for dashboard + DB + Redis)
- **Agent host**: Bash 4+ OR Python 3.11+

### 1. Clone & Configure

```bash
git clone https://github.com/yourusername/openshield.git
cd openshield

# Copy environment template
cp .env.example .env

# Edit secrets (CHANGE THESE!)
nano .env
```

**Minimum required env vars:**

```bash
POSTGRES_PASSWORD=change-me-strong-password
SESSION_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
INGEST_HMAC_SECRET=$(openssl rand -hex 32)
```

### 2. Start the Stack

```bash
docker compose up -d
```

This starts:
- `openshield-app` (Next.js on port 3001)
- `openshield-postgres` (PostgreSQL 16 on port 5433)
- `openshield-redis` (Redis 7 on port 6379)

### 3. Initialize Database

```bash
# Run migrations
docker compose exec app npx prisma migrate deploy

# Create first owner user
docker compose exec app npx prisma db seed
# Or use the UI (visit http://localhost:3001)
```

### 4. Access Dashboard

Open **http://localhost:3001** in your browser.

Login with the credentials you set during seeding (or the default from `.env`).

### 5. Add Your First Agent

#### In the UI:

1. Login as OWNER/ADMIN
2. Go to **Settings → Agents → Add Agent**
3. Fill in name (e.g. `prod-web-jkt-01`)
4. Pick type: **BASH** (lightweight) or **PYTHON** (full-featured)
5. Click **Create Agent**
6. **Copy the token** (shown ONCE — can't be recovered!)

#### On the monitored host:

**Bash Agent (lightweight, no dependencies):**

```bash
# Download installer
curl -O https://raw.githubusercontent.com/yourusername/openshield/main/agents/bash/install.sh

# Install
sudo bash install.sh

# Configure
sudo vi /etc/openshield/agent.json
# Paste agent_id + secret_token from UI

# Start
sudo systemctl restart openshield-agent
sudo systemctl status openshield-agent
```

**Python Agent (full features, FIM + process watch):**

```bash
# Download installer
curl -O https://raw.githubusercontent.com/yourusername/openshield/main/agents/python/install.sh

# Install (auto-installs Python deps)
sudo bash install.sh

# Configure
sudo vi /etc/openshield/agent.yaml
# Paste agent_id + secret_token from UI

# Start
sudo systemctl restart openshield-agent
sudo systemctl status openshield-agent
```

#### Back in UI:

- Your agent row should show **ONLINE** within 30 seconds
- Events will appear under the agent's row in real-time

---

## 📊 Installation Progress

Track what's done and what's coming:

### ✅ **v0.1.0 — Core Platform** (Shipped 2026-06)

#### Backend & Infrastructure

- [x] Docker Compose stack (app + postgres + redis)
- [x] PostgreSQL 16 schema with Prisma ORM
- [x] Redis cache + BullMQ job queue
- [x] Healthcheck endpoints
- [x] Database migrations + seed script

#### Authentication & Security

- [x] Argon2id password hashing
- [x] JWT + refresh token rotation
- [x] RBAC (OWNER / ADMIN / VIEWER)
- [x] HMAC-SHA256 agent authentication
- [x] AES-256-GCM credential encryption
- [x] Login rate limiting (5/min/IP)
- [x] Audit log with hash chaining (tamper-evident)
- [x] OWASP Top 10:2021 + API:2023 + ASVS 4.0.3 L1+L2 compliance

#### Agent Management

- [x] Agent registration UI (generate agent_id + secret_token)
- [x] Agent heartbeat endpoint (HMAC-verified)
- [x] Token rotation + revocation
- [x] Agent health monitoring (ONLINE / OFFLINE / ERROR / REVOKED)
- [x] Bash agent (zero dependencies)
- [x] Python agent (full features)
- [x] systemd service installer (auto-restart, hardening)

#### Event Collection

- [x] SSH log parser (auth.log / secure)
- [x] sudo log parser
- [x] **Syslog parser** (RFC 3164 BSD + RFC 5424 ISO 8601 dual format)
- [x] **SFTP/SCP detection** in SSH subsystem
- [x] MySQL/MariaDB login tracking (via file + DB hybrid)
- [x] PostgreSQL login tracking (via log + DB hybrid)
- [x] SQL Server error log tracking

#### File Integrity Monitoring (FIM)

- [x] SHA-256 baseline on critical paths
- [x] Change detection with alerts
- [x] Baseline persistence
- [x] Dedicated FIM page in dashboard

#### Dashboard UI

- [x] **Security Overview** — KPI cards, charts, recent events
- [x] **Events / Syslog** — filtered syslog events (kernel, cron, docker, etc.)
- [x] **Events / Server Auth** — SSH, sudo, DB logins
- [x] **Events / FIM** — file integrity changes
- [x] **Agent Endpoint** — agent inventory + health
- [x] **Database Assets** — monitored servers/DBs
- [x] **Alerts** — real-time alert feed
- [x] **Audit Log** — tamper-evident user actions
- [x] **Reports** — exportable summaries
- [x] **Analysis** — advanced search + charts
- [x] **Apps** — third-party integrations (planned)
- [x] **Settings** — system config
- [x] **Profile** — user account + MFA setup

#### Real-Time Features

- [x] Socket.IO live event feed
- [x] Optimistic UI updates
- [x] Toast notifications (Sonner)
- [x] Auto-refresh agent status

#### Developer Experience

- [x] Turbopack dev mode (10x faster HMR)
- [x] TypeScript strict mode
- [x] ESLint configuration
- [x] Husky pre-commit hooks
- [x] Agent sync check script (`npm run check-agent`)

---

### 🚧 **v0.2.0 — Advanced Monitoring** (Q3 2026)

- [ ] **Auditd Parser** — kernel syscall + file access monitoring
- [ ] **journald Parser** — binary log stream integration
- [ ] GeoIP enrichment on source IPs
- [ ] Anomaly detection rules engine (failed-login bursts, new-country logins, off-hours)
- [ ] Webhook / Slack / Telegram alert channels
- [ ] MFA (TOTP) end-to-end UI flow
- [ ] Multi-tenant org support
- [ ] SSH key audit (who can SSH where, when last rotated)
- [ ] Windows / RDP collector

### 🔮 **v0.3.0 — Scale & HA** (Q4 2026)

- [ ] **Service split**: app-web + app-poller + app-worker (independent scaling)
- [ ] **TimescaleDB migration** (for 50–500 agents)
- [ ] **PostgreSQL replication** (primary + read replica)
- [ ] **Redis Sentinel** (HA cache + queue)
- [ ] **Load balancer** (HAProxy or Nginx)
- [ ] **Observability stack** (Prometheus + Grafana)

### 🌟 **v1.0.0 — Enterprise Ready** (Q1 2027)

- [ ] **ClickHouse** integration (for 500+ agents)
- [ ] **Multi-region** support
- [ ] **SAML / LDAP** SSO
- [ ] **Compliance reports** (SOC 2, ISO 27001 templates)
- [ ] **Helm chart** for Kubernetes
- [ ] **Cloud integrations** — AWS CloudTrail, Azure Event Hub, GCP Cloud Logging
- [ ] **eBPF-based** process/network monitoring

---

## ⚙️ Configuration

### Environment Variables

All configuration via `.env` file (see `.env.example` for full list):

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `POSTGRES_PASSWORD` | ✅ | — | Database password |
| `SESSION_SECRET` | ✅ | — | JWT signing secret (32+ bytes) |
| `ENCRYPTION_KEY` | ✅ | — | AES-256-GCM key (32 bytes hex) |
| `INGEST_HMAC_SECRET` | ✅ | — | Agent heartbeat HMAC secret |
| `REDIS_PASSWORD` | ✅ | — | Redis auth password |
| `PUBLIC_URL` | ⚠️ | `http://localhost:3001` | Public URL for agent callbacks |
| `CORS_ORIGINS` | ⚠️ | `""` | Comma-separated allowed origins |
| `LOGIN_RATE_LIMIT` | ❌ | `5` | Login attempts per minute per IP |
| `COOKIE_SECURE` | ❌ | `false` | Set `true` behind HTTPS reverse proxy |
| `POLLER_INTERVAL_SECONDS` | ❌ | `30` | DB/SSH poll interval |
| `POLLER_ENABLED` | ❌ | `true` | Enable/disable outbound poller |
| `OPENSHIELD_PUBLIC_URL` | ⚠️ | — | Used in agent install commands |

### Agent Configuration

#### Bash Agent (`/etc/openshield/agent.json`)

```json
{
  "server_url": "http://openshield.example.com:3001",
  "agent_id": "cmq123abc...",
  "secret_token": "os_agt_64charhex...",
  "agent_name": "prod-web-jkt-01",
  "heartbeat_interval": 30,
  "event_batch_size": 100,
  "log_paths": [
    {"path": "/var/log/auth.log", "parser": "sshd"},
    {"path": "/var/log/syslog", "parser": "syslog"},
    {"path": "/var/log/secure", "parser": "sshd"}
  ]
}
```

Can also be set via environment variables:

```bash
export OPENSHIELD_SERVER_URL=http://...
export OPENSHIELD_AGENT_ID=cmq...
export OPENSHIELD_SECRET_TOKEN=os_agt_...
```

#### Python Agent (`/etc/openshield/agent.yaml`)

```yaml
server_url: "http://openshield.example.com:3001"
agent_id: "cmq123abc..."
secret_token: "os_agt_64charhex..."
agent_name: "prod-web-jkt-01"

heartbeat_interval: 30
event_batch_size: 100

# File Integrity Monitoring (FIM)
fim_paths:
  - /etc/passwd
  - /etc/shadow
  - /etc/sudoers
  - /etc/ssh/sshd_config
  - /etc/crontab

# Process watchlist (regex patterns)
process_watchlist:
  - '^(www-data|nginx|apache) .* (/bin/(ba)?sh)$'
  - '(xmrig|cryptonight|stratum\+tcp)'
  - '(nc|ncat|netcat)\s.*-e\s'

# Log watchers (new in v0.1.0)
log_watchers:
  - path: /var/log/syslog
    parser: syslog
  - path: /var/log/messages
    parser: syslog
```

See `agents/python/config.example.yaml` for all options.

---

## 🎯 Use Cases

### 1. **Detect SSH Brute-Force Attacks**

```
Scenario: Attacker tries 1000 passwords on prod-web-01

What OpenShield shows:
- Failed login attempts spike (chart: events by severity)
- Source IP appears in top attackers
- After 5 failures → WARN alert
- After 50 failures → CRITICAL alert
- GeoIP: source from unexpected country
```

### 2. **Monitor Database Credential Stuffing**

```
Scenario: Attacker rotates through leaked username/passwords against PostgreSQL

What OpenShield shows:
- Failed DB login attempts spike
- Source IP scans multiple DB assets in 1 minute
- Pattern: same IP, different users, different DBs
- Real-time alert in dashboard
```

### 3. **Track Privilege Escalation Attempts**

```
Scenario: Compromised web app tries `sudo cat /etc/shadow`

What OpenShield shows:
- Process anomaly alert (nginx → /bin/sh)
- sudo auth failure event
- FIM alert if /etc/shadow is read (via auditd)
- Full timeline in audit log
```

### 4. **Compliance Audit Trail (SOC 2 / ISO 27001)**

```
Scenario: Auditor asks "who logged into prod-db-01 in March?"

What OpenShield provides:
- Searchable event log (timestamp, user, IP, success/fail)
- Tamper-evident audit log (hash-chained)
- Exportable CSV/Excel reports
- User action audit (who created/rotated/revoked agents)
```

### 5. **File Integrity Monitoring (PCI-DSS Requirement 11.5)**

```
Scenario: Attacker modifies /etc/passwd to add backdoor user

What OpenShield shows:
- FIM alert: SHA-256 mismatch on /etc/passwd
- Diff: new line "backdoor:x:0:0::/root:/bin/bash"
- Timestamp + process that modified it (via auditd)
- Correlate with other events around same time
```

---

## 🛠️ Development

### Local Setup

#### Option 1: Manual (Recommended for Active Development)

```bash
# 1. Install dependencies
npm install

# 2. Copy env
cp .env.example .env

# 3. Start dev services (postgres + redis via docker)
docker compose up postgres redis -d

# 4. Run migrations
npx prisma migrate dev

# 5. Start dev server (Turbopack)
npm run dev

# Open http://localhost:3001
```

#### Option 2: Systemd Service (Persistent Background Dev Server)

Ada systemd service untuk menjaga dev server berjalan otomatis:

```bash
# Start service
sudo systemctl start openshield-dev.service

# Check status
sudo systemctl status openshield-dev.service

# Stop service
sudo systemctl stop openshield-dev.service

# Disable auto-start on boot
sudo systemctl disable openshield-dev.service

# Enable auto-start on boot
sudo systemctl enable openshield-dev.service

# View logs
sudo journalctl -u openshield-dev.service -f
```

Service ini menjalankan `pnpm dev` di port 3001 dengan Turbopack.

### Development Scripts

```bash
npm run dev              # Turbopack dev server (port 3001)
npm run build            # Production build
npm run start            # Production server
npm run lint             # ESLint
npm run check-agent      # Verify agent code is in sync
npm run sync-agent       # Pull agent from /opt/openshield-agent/
```

### Project Structure

```
openshield/
├── agents/                      # Host agents
│   ├── bash/                   # Lightweight bash agent
│   │   ├── agent.sh
│   │   ├── config.example.json
│   │   └── install.sh
│   ├── python/                 # Full-featured Python agent
│   │   ├── agent.py
│   │   ├── config.example.yaml
│   │   ├── requirements.txt
│   │   └── install.sh
│   └── README.md
├── docker/
│   ├── Dockerfile
│   └── init/                   # DB init scripts
├── prisma/
│   ├── schema.prisma           # Database schema
│   └── migrations/
├── scripts/
│   └── check-agent-sync.sh
├── src/
│   ├── app/
│   │   ├── api/                # REST + Socket.IO endpoints
│   │   ├── dashboard/          # Protected pages
│   │   ├── login/
│   │   └── ...
│   ├── components/             # Shared UI components
│   └── lib/                    # Utilities, parsers, auth
├── docker-compose.yml
├── .env.example
├── next.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

### Performance Tuning (Production)

For high-traffic deployments, enable PM2 cluster mode:

```bash
# Build
npm run build

# Start with PM2 (uses all CPU cores)
pm2 start npm --name openshield \
  --max-memory-restart 1G \
  -- -i max \
  -- run start

# Status
pm2 status
pm2 logs openshield
```

Or with Docker Compose replicas:

```bash
docker compose up -d --scale app=4
# Add Nginx/HAProxy in front for load balancing
```

---

## 🛣️ Roadmap

See the [Installation Progress](#-installation-progress) section above for detailed roadmap.

**High-level timeline:**

- **v0.1.0** (✅ Now) — Core SSH + DB auth monitoring
- **v0.2.0** (Q3 2026) — Auditd + journald + alerts + MFA
- **v0.3.0** (Q4 2026) — Scale-out architecture
- **v1.0.0** (Q1 2027) — Enterprise features

---

## 🤝 Contributing

We welcome contributions! 🎉

### How to Contribute

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run `npm run lint` and ensure tests pass
5. Commit your changes (`git commit -m 'feat: add amazing feature'`)
6. Push to branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new feature
fix: bug fix
docs: documentation only
style: formatting, no code change
refactor: code change that neither fixes bug nor adds feature
perf: performance improvement
test: add tests
chore: build/tool changes
```

### Code of Conduct

Be respectful, constructive, and inclusive. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

---

## 📄 License

OpenShield is released under the **MIT License**. See [LICENSE](LICENSE) for details.

```
MIT License

Copyright (c) 2026 OpenShield Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 🙏 Acknowledgments

Built with amazing open-source projects:

- [Next.js](https://nextjs.org) — React framework
- [Prisma](https://www.prisma.io) — Type-safe ORM
- [PostgreSQL](https://www.postgresql.org) — Database
- [Redis](https://redis.io) — Cache & queue
- [Socket.IO](https://socket.io) — Real-time engine
- [Radix UI](https://www.radix-ui.com) — Accessible components
- [Tailwind CSS](https://tailwindcss.com) — Styling
- [Argon2](https://github.com/P-H-C/phc-winner-argon2) — Password hashing

Inspired by:
- [Wazuh](https://wazuh.com) — SIEM architecture patterns
- [OSSEC](https://www.ossec.net) — Host-based IDS concepts
- [Fail2ban](https://github.com/fail2ban/fail2ban) — Brute-force detection ideas

---

## 📞 Support & Community

- **GitHub Issues**: [github.com/yourusername/openshield/issues](https://github.com/yourusername/openshield/issues)
- **Discussions**: [github.com/yourusername/openshield/discussions](https://github.com/yourusername/openshield/discussions)
- **Documentation**: [github.com/yourusername/openshield/wiki](https://github.com/yourusername/openshield/wiki)
- **Security**: See [SECURITY.md](SECURITY.md) for reporting vulnerabilities

---

## ⚠️ Disclaimer

OpenShield is a **detection and visibility tool**, not a complete security solution. It complements but does not replace:

- Firewalls (UFW, iptables, cloud security groups)
- IDS/IPS (Suricata, Snort)
- WAF (ModSecurity, Cloudflare)
- Patch management (unattended-upgrades, Ansible)
- Backup & disaster recovery
- Security training & awareness

Use OpenShield as **one layer** in a defense-in-depth strategy.

---

**🛡️ Built with ❤️ for the self-hosted community.**
