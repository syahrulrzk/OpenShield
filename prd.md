# OpenShield — Product Requirements Document (PRD)

> **Document version**: 1.0
> **Status**: Retrospective + forward-looking (v0.1.0 shipped; roadmap for v0.2+ planned)
> **Owner**: TBD
> **Last updated**: 2026-06-18
> **Related docs**: `README.md`, `SECURITY.md`, `AGENTS.md`

---

## 1. Executive Summary

**OpenShield** is a self-hosted, security-first observability dashboard for small-to-mid infrastructure teams who need to **detect and triage unauthorized access attempts on Linux servers and databases** — without paying enterprise SIEM prices or shipping data to third-party clouds.

It collects authentication events from SSH servers and databases (PostgreSQL/MySQL/SQL Server) via outbound, credential-isolated collectors, stores them in a tamper-evident audit log, and surfaces anomalies as alerts through a real-time web dashboard.

**Differentiators**
- **Self-hosted & open-by-design**: Docker Compose deploy, all data stays on your infra.
- **Security-first**: Argon2id + JWT + AES-256-GCM + hash-chained audit log, OWASP Top 10:2021 + API:2023 + ASVS 4.0.3 compliant from day one.
- **Credential-zero-client**: plaintext SSH keys / DB passwords never leave the server.
- **Lightweight**: tracks login metadata only (no query capture, no full packet inspection).

---

## 2. Problem Statement

### 2.1 The pain

Small infra teams (startups, scale-ups, internal IT) running 5–100 Linux boxes and 2–20 database instances face a recurring gap:

- **No visibility into who is trying to log in**, where from, and whether the attempt succeeded.
- **Brute-force / credential-stuffing attacks** on SSH and DB ports go unnoticed until damage is done.
- **Log sprawl**: `auth.log`, `pg_log`, `mysqld.log`, SQL Server error log — all in different formats, scattered across hosts.
- **Enterprise SIEMs** (Splunk, Elastic SIEM, Datadog Cloud SIEM) are overkill, expensive, and often cloud-only.
- **Compliance asks** (SOC 2, ISO 27001, internal audit) require tamper-evident audit trails and RBAC.

### 2.2 The opportunity

A focused, single-binary (well, single Docker Compose stack) tool that:
- Pulls SSH + DB auth events into one queryable place.
- Surfaces real-time alerts when something looks off.
- Stores everything in a tamper-evident, exportable audit log.
- Costs nothing to self-host.

---

## 3. Goals & Non-Goals

### 3.1 Goals (v0.1.0 — ✅ shipped)

| # | Goal | Status |
|---|------|--------|
| G1 | Monitor SSH login attempts (success / failed / invalid user) across N servers | ✅ |
| G2 | Monitor DB login attempts (Postgres, MySQL, SQL Server) | ✅ |
| G3 | Web dashboard with real-time event feed (Socket.IO) | ✅ |
| G4 | Encrypted credential vault for collector access | ✅ |
| G5 | RBAC (Owner / Admin / Viewer) | ✅ |
| G6 | Tamper-evident audit log with hash chaining | ✅ |
| G7 | OWASP Top 10:2021 + API Security:2023 + ASVS 4.0.3 L1+L2 | ✅ |
| G8 | Single-command Docker Compose deploy | ✅ |

### 3.2 Goals (v0.2+ — planned)

| # | Goal | Priority |
|---|------|----------|
| G9 | GeoIP enrichment on source IPs | High |
| G10 | Anomaly detection rules engine (failed-login bursts, new-country logins, off-hours) | High |
| G11 | Webhook / Slack / Telegram alert channels | High |
| G12 | MFA (TOTP) end-to-end UI flow | Medium |
| G13 | Multi-tenant org support (today: single-owner only) | Medium |
| G14 | SSH key audit (who can SSH where, when last rotated) | Medium |
| G15 | Windows / RDP collector | Low |
| G16 | Linux process / network connection collector (eBPF) | Low |

### 3.3 Non-Goals (explicit out of scope)

- ❌ Full packet capture / NDR (network detection & response).
- ❌ Query-level DB activity monitoring (DAM) — we only track auth.
- ❌ Host-based IDS (file integrity, rootkit detection) — leave to OSSEC/Wazuh.
- ❌ Cloud-managed SaaS offering (v1).
- ❌ Mobile app (responsive web is sufficient for v1).

---

## 4. Target Users / Personas

### 4.1 Persona A — **DevOps / SRE Lead** ("Maya")
- **Context**: 3-person team, runs 30 Linux boxes + 5 Postgres instances for a SaaS product.
- **Pain**: Every few months, someone tries to brute-force SSH. She finds out from a customer's complaint, not from monitoring.
- **Wants**: One dashboard showing "who tried what, where from, when". Alerts in Slack when weird stuff happens.
- **Permissions**: Owner.

### 4.2 Persona B — **Security Engineer** ("Rizky")
- **Context**: Part-time security role at a 50-person fintech. Needs to produce audit evidence for SOC 2.
- **Pain**: No centralized audit log of who accessed what. Spent 2 days last quarter grepping auth.log across 12 boxes.
- **Wants**: Tamper-evident audit log, exportable, queryable. RBAC so he can give Viewer access to auditors without giving them control.
- **Permissions**: Owner (read-only desired for auditors → Viewer).

### 4.3 Persona C — **Compliance Auditor** ("External")
- **Context**: External auditor reviewing SOC 2 controls.
- **Pain**: Wants evidence, not access.
- **Wants**: Time-bounded, read-only Viewer account. Export to CSV / PDF.
- **Permissions**: Viewer.

### 4.4 Persona D — **CTO / Founder** ("Bos")
- **Context**: Owns the company. Doesn't log in often, but wants a green dashboard.
- **Pain**: Doesn't want to read logs, wants to know "are we safe?".
- **Wants**: High-level KPIs (assets online, alerts open, failed logins last 24h).
- **Permissions**: Owner.

---

## 5. User Stories

### 5.1 Onboarding

- **US-1**: As Maya, I can `git clone` + `docker compose up` and have a working dashboard in under 10 minutes.
- **US-2**: As Maya, after first boot I'm guided to create my Owner account (no default credentials).
- **US-3**: As Maya, I can add my first SSH server by pasting my SSH key (encrypted client-side or via Web UI, never sent in plaintext over the wire).

### 5.2 Day-to-day monitoring

- **US-4**: As Maya, I see a real-time feed of auth events as they happen, no page refresh.
- **US-5**: As Rizky, I can filter the feed by asset, status (failed/success), IP, time range.
- **US-6**: As Rizky, I can drill from an alert into the source IP's full history across all assets.
- **US-7**: As Maya, when 5 failed SSH logins happen in 60 seconds from one IP, I get a CRITICAL alert and a Slack ping.

### 5.3 Alerting

- **US-8**: As Maya, I can configure alert rules (threshold, window, channels).
- **US-9**: As Rizky, I can resolve an alert and leave a note (audit-logged).
- **US-10**: As Maya, alerts that go unacknowledged for >24h get escalated (re-sent, marked).

### 5.4 Audit & compliance

- **US-11**: As Rizky, every state-changing action (login, asset add, credential view, alert resolve) shows up in an immutable audit log.
- **US-12**: As Rizky, I can verify the audit log hash chain integrity with one click.
- **US-13**: As an External Auditor, I can be given a time-bounded Viewer account that expires automatically.
- **US-14**: As Rizky, I can export the audit log + asset list to CSV/JSON for compliance evidence.

### 5.5 Security & access control

- **US-15**: As Rizky, even if my laptop is stolen, the attacker can't read my SSH keys — they're decrypted only server-side, in memory, in the collector worker.
- **US-16**: As Maya, my refresh tokens auto-rotate on every use; old ones are invalidated.
- **US-17**: As Rizky, after 5 failed logins from one IP in 15 min, the IP is temporarily rate-limited (defense in depth).

---

## 6. Functional Requirements

### 6.1 Authentication & Session Management

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-AUTH-1 | Email + password login with Argon2id (m=19MiB, t=2, p=1) | P0 | ✅ |
| FR-AUTH-2 | JWT access token (HS256, 15 min expiry) | P0 | ✅ |
| FR-AUTH-3 | Refresh token (7 days, rotated on use, hashed in DB) | P0 | ✅ |
| FR-AUTH-4 | "Sign out of all sessions" (revokes all refresh tokens) | P0 | ✅ |
| FR-AUTH-5 | Change password (requires current password) | P0 | ✅ |
| FR-AUTH-6 | Rate limit: 5 failed logins / 15 min / IP → temp lockout | P0 | ✅ |
| FR-AUTH-7 | TOTP MFA (slot in schema; UI in v0.2) | P1 | 🔜 |
| FR-AUTH-8 | Password reset via email token (1h, single-use) | P1 | 🔜 |

### 6.2 Asset Management

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-ASSET-1 | Add asset (SSH / DATABASE category, env: PROD/STAGING/UAT/DEV/DR) | P0 | ✅ |
| FR-ASSET-2 | Encrypted credential storage (AES-256-GCM, key from env) | P0 | ✅ |
| FR-ASSET-3 | Asset status (PENDING / ONLINE / OFFLINE / ERROR) with last_seen timestamp | P0 | ✅ |
| FR-ASSET-4 | Delete asset (cascades to credentials, events, alerts) | P0 | ✅ |
| FR-ASSET-5 | Edit asset metadata (hostname, IPs, tags) | P1 | 🔜 |
| FR-ASSET-6 | Bulk import (CSV / Terraform provider) | P2 | 📋 |

### 6.3 Collectors

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-COL-1 | SSH collector: outbound SSH, reads `/var/log/auth.log` (or journalctl), parses login success / failed / invalid user | P0 | ✅ |
| FR-COL-2 | PG collector: queries `pg_stat_activity` for auth-related events | P0 | ✅ |
| FR-COL-3 | MySQL collector: reads `general_log` or error log for auth events | P0 | ✅ |
| FR-COL-4 | SQL Server collector: reads ERRORLOG / login audit | P0 | ✅ |
| FR-COL-5 | Polling interval config (default 60s, env-overridable) | P0 | ✅ |
| FR-COL-6 | Job queue with retry + timeout (BullMQ) | P0 | ✅ |
| FR-COL-7 | RDP / Windows collector | P2 | 📋 |

### 6.4 Events & Feed

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-EVT-1 | Persist SSH events (username, source IP, status, method, time) | P0 | ✅ |
| FR-EVT-2 | Persist DB events (dbType, user, IP, db, status, time) | P0 | ✅ |
| FR-EVT-3 | Real-time WebSocket push to dashboard | P0 | ✅ |
| FR-EVT-4 | Filter by asset / status / IP / time range | P0 | ✅ |
| FR-EVT-5 | GeoIP enrichment on source IP | P1 | 🔜 |
| FR-EVT-6 | Country-flag column, world map view | P2 | 📋 |

### 6.5 Alerts

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-ALERT-1 | Auto-generated alerts (e.g. 5+ failed SSH from one IP in 60s) | P1 | 🔜 |
| FR-ALERT-2 | Manual resolution with note (audit-logged) | P0 | ✅ |
| FR-ALERT-3 | Severity (LOW / MEDIUM / HIGH / CRITICAL) | P0 | ✅ |
| FR-ALERT-4 | Webhook / Slack / Telegram channels | P1 | 🔜 |
| FR-ALERT-5 | Alert escalation rules | P2 | 📋 |

### 6.6 Reporting

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-RPT-1 | KPI dashboard (assets online, alerts open, failed logins / 24h) | P0 | ✅ |
| FR-RPT-2 | Analysis report (charts: events over time, top source IPs, top usernames) | P0 | ✅ |
| FR-RPT-3 | Export events to Excel (`.xlsx`) | P0 | ✅ |
| FR-RPT-4 | Scheduled reports (daily/weekly PDF email) | P2 | 📋 |

### 6.7 Audit Log

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-AUDIT-1 | Append-only audit log (login, asset CRUD, credential view, alert action) | P0 | ✅ |
| FR-AUDIT-2 | Hash chain (SHA-256 of prevHash + row content) for tamper detection | P0 | ✅ |
| FR-AUDIT-3 | Verify-chain endpoint with one-click integrity check | P1 | 🔜 |
| FR-AUDIT-4 | Export audit log (JSON for SIEM ingest) | P1 | 🔜 |

### 6.8 User Management (RBAC)

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-USER-1 | Invite user by email (Owner only) | P1 | 🔜 |
| FR-USER-2 | Role assignment: Owner / Admin / Viewer | P0 | ✅ |
| FR-USER-3 | Permission matrix enforced server-side on every endpoint | P0 | ✅ |
| FR-USER-4 | Time-bounded Viewer access for external auditors | P2 | 📋 |

---

## 7. Technical Architecture

### 7.1 High-level

```
┌──────────────────────────────────────────────────────────┐
│                  OpenShield (Next.js 16)                  │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────┐ │
│  │  Dashboard UI  │  │   REST API     │  │ WebSocket  │ │
│  │  (React 19)    │  │  (App Router)  │  │ (Socket.IO)│ │
│  └────────┬───────┘  └────────┬───────┘  └─────┬──────┘ │
│           │                   │                │        │
│           └───────────────────┼────────────────┘        │
│                               ▼                          │
│              ┌────────────────────────────┐             │
│              │   Service Layer (lib/)     │             │
│              │  auth • crypto • rbac •    │             │
│              │  ratelimit • audit         │             │
│              └─────────────┬──────────────┘             │
│                            ▼                            │
│            ┌──────────────────────────────┐             │
│            │      BullMQ Job Queue        │             │
│            └──────┬───────────────────┬───┘             │
│                   ▼                   ▼                  │
│         ┌──────────────────┐  ┌──────────────────┐      │
│         │ SSH Collector    │  │ DB Collector     │      │
│         │ (ssh2, outbound) │  │ (pg/mysql/mssql) │      │
│         └──────────────────┘  └──────────────────┘      │
└──────────┬──────────────────────────┬───────────────────┘
           ▼                          ▼
   ┌──────────────┐           ┌──────────────┐
   │ PostgreSQL   │           │ Redis        │
   │  16 (Alpine) │           │  7 (Alpine)  │
   └──────────────┘           └──────────────┘
```

### 7.2 Tech stack (pinned, see `package.json`)

| Layer | Tech | Version |
|-------|------|---------|
| Framework | Next.js (App Router) | 16.2.9 |
| Language | TypeScript | 5.x |
| UI | React | 19.2.4 |
| Styling | Tailwind CSS | 4.x |
| Components | Radix UI + shadcn-style | latest |
| Animation | Framer Motion | 12.x |
| ORM | Prisma | 6.19.3 |
| Database | PostgreSQL | 16 (Alpine) |
| Cache / Queue | Redis + BullMQ | 7 / 5.78 |
| Realtime | Socket.IO | 4.8 |
| Auth | jose (JWT) + argon2 | 6 / 0.44 |
| Crypto | Node `crypto` (AES-256-GCM) | — |
| Validation | Zod | 4.x |
| Charts | Recharts | 3.x |
| Excel | ExcelJS | 4.x |
| SSH | ssh2 | 1.17 |
| DB drivers | pg, mysql2, mssql | latest |
| Container | Docker Compose (Alpine base, non-root uid 1001) | — |

### 7.3 Deployment topology

| Service | Container | Host port → Container | Bound to |
|---------|-----------|----------------------|----------|
| App | openshield-app | 3001 → 3000 | 0.0.0.0 |
| Postgres | openshield-postgres | 5433 → 5432 | 127.0.0.1 |
| Redis | openshield-redis | 6380 → 6379 | 127.0.0.1 |

- Internal Docker network: `openshield` (no host bridge between DB/Redis).
- All services have healthchecks + restart policy.
- Secrets via `.env` (gitignored) — see `.env.example` for schema.

---

## 8. Data Model (summary)

See `prisma/schema.prisma` for full definition.

| Model | Purpose | Cardinality |
|-------|---------|-------------|
| `User` | Dashboard users | 1 user → N assets, N refresh tokens, N audit logs |
| `RefreshToken` | Rotating session tokens | N per user |
| `Asset` | Monitored server / DB | 1 user → N assets, 1 asset → 0..1 SSH cred + 0..1 DB cred |
| `AssetCredential` | Encrypted SSH key + DB conn string | 1 per asset (per type) |
| `SshEvent` | SSH login attempt | N per asset |
| `DbEvent` | DB login attempt | N per asset |
| `Alert` | Security alert | N per asset (or unscoped) |
| `AuditLog` | Tamper-evident action log | N per user (nullable for system actions) |
| `SystemSetting` | Key-value singleton config | sparse |

**Enums**: `UserRole`, `AssetCategory`, `Environment`, `AssetStatus`, `DbType`, `SshStatus`, `DbEventStatus`, `AlertSeverity`, `AlertStatus`.

---

## 9. Security & Compliance

OpenShield is designed as a **security product**, so the bar is higher than a typical CRUD app.

### 9.1 Compliance status

| Standard | Status |
|----------|--------|
| OWASP Top 10:2021 | ✅ Compliant |
| OWASP API Security:2023 | ✅ Compliant |
| OWASP ASVS 4.0.3 L1+L2 | ✅ Compliant |
| NIST SP 800-63B (passwords) | ✅ Applied |
| SOC 2 Type II | 🔜 Phase 2 |
| ISO 27001 | 📋 Phase 3 |
| GDPR DPA | 📋 Phase 2 |

### 9.2 Threat model

See `SECURITY.md` § 1 for full STRIDE matrix. Highlights:

- **Spoofing**: JWT signing key never leaves env; HS256 prevents token tampering.
- **Tampering**: Audit log hash chain; AES-256-GCM auth tag on credentials.
- **Repudiation**: Every state change logged with userId, IP, UA, timestamp.
- **Information Disclosure**: Credentials decrypted server-side only, never serialized to client.
- **DoS**: Rate limits at edge + lockout on auth.
- **EoP**: RBAC enforced server-side on every endpoint.

### 9.3 Security headers

`next.config.ts` sets:
- `Content-Security-Policy` (strict, no `unsafe-eval`)
- `Strict-Transport-Security: max-age=63072000; includeSubDomains`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

### 9.4 Rate limiting

| Surface | Limit |
|---------|-------|
| Login | 5 attempts / 15 min / IP |
| API (general) | 100 req / min / user |
| Asset add | 10 / hour / user |
| Credential view | 30 / hour / user (audit-logged) |

### 9.5 Outbound SSRF protection

Collectors connect outbound to user-configured targets only. No URL is taken from request body and concatenated. Targets stored in DB. Collector workers run in isolated network namespace.

---

## 10. Non-Functional Requirements

| ID | Category | Requirement | Target |
|----|----------|-------------|--------|
| NFR-1 | Performance | Dashboard first contentful paint | < 1.5 s on cached page |
| NFR-2 | Performance | Event ingestion end-to-end | < 5 s from auth attempt to dashboard tile |
| NFR-3 | Performance | Sustained event rate | 1,000 events/sec (single node) |
| NFR-4 | Availability | Single-node uptime target | 99.5% (self-hosted) |
| NFR-5 | Scalability | Max assets supported | 500 assets per instance |
| NFR-6 | Scalability | Max concurrent dashboard users | 50 |
| NFR-7 | Durability | Audit log retention | Indefinite (DB-backed) |
| NFR-8 | Durability | Backup recommendation | Daily `pg_dump` to off-host |
| NFR-9 | Observability | `/api/health` endpoint for monitoring | ✅ |
| NFR-10 | Internationalization | UI languages | English (v1); i18n slot ready |
| NFR-11 | Accessibility | WCAG 2.1 AA | Radix UI primitives → mostly compliant |
| NFR-12 | Browser support | Last 2 versions of Chrome / Firefox / Safari / Edge | — |

---

## 11. API Surface (current)

REST API (App Router conventions, all under `/api/`):

### Auth
- `POST /api/auth/register` — first-user registration
- `POST /api/auth/login` — email + password → JWT + refresh cookie
- `POST /api/auth/refresh` — rotate refresh token
- `POST /api/auth/logout` — revoke current refresh token
- `POST /api/auth/logout-all` — revoke all refresh tokens for user
- `POST /api/auth/change-password` — change password (requires current)
- `GET  /api/auth/me` — current user info

### Assets
- `GET    /api/assets` — list user's assets
- `POST   /api/assets` — create asset (+ optional credentials)
- `GET    /api/assets/[id]` — read one asset
- `PATCH  /api/assets/[id]` — update asset
- `DELETE /api/assets/[id]` — delete asset

### Users (Owner only)
- `GET    /api/users` — list users
- `POST   /api/users` — invite user
- `GET    /api/users/[id]` — read user
- `PATCH  /api/users/[id]` — update user role / active state
- `DELETE /api/users/[id]` — delete user

### Reports
- `GET /api/reports/events` — filtered event export (JSON / xlsx)
- `GET /api/reports/analysis` — aggregated KPIs + time series

### Notifications
- `GET  /api/notifications` — list current user's notifications
- `POST /api/notifications/mark-read` — mark one / all read

### Settings
- `GET  /api/settings` — read system settings (filtered by role)
- `POST /api/settings` — update settings (Owner/Admin only)

### Health
- `GET /api/health` — liveness + readiness (no version leak)

### WebSocket
- `ws://host:3001/socket.io` — real-time event push (token on upgrade)

---

## 12. UI Surface (current)

| Route | Purpose | Roles |
|-------|---------|-------|
| `/` | Landing / redirect to `/dashboard` or `/login` | public |
| `/login` | Login form | public |
| `/dashboard` | KPI overview, live event stream | all authed |
| `/dashboard/assets` | Asset list + CRUD | all authed |
| `/dashboard/events` | Event explorer (filterable) | all authed |
| `/dashboard/events/database` | DB-only event view | all authed |
| `/dashboard/events/aplikasi` | App events (upcoming) | all authed |
| `/dashboard/alerts` | Alert list + resolve | all authed |
| `/dashboard/analysis` | Charts + analysis report | all authed |
| `/dashboard/reports` | Exportable reports | all authed |
| `/dashboard/notifications` | User notifications | all authed |
| `/dashboard/settings` | System settings (theme, alerts, etc.) | Owner/Admin |
| `/dashboard/profile` | User profile + change password | all authed |

---

## 13. Roadmap

### Phase 1 — v0.1.0 (✅ shipped, current)
Foundation: auth, asset CRUD, SSH + DB collectors, basic events feed, alerts (manual resolve), audit log, RBAC, Docker Compose deploy.

### Phase 2 — v0.2.0 (next, ~6 weeks)
- Auto-generated alerts (rule engine: threshold-based).
- Webhook / Slack / Telegram notification channels.
- GeoIP enrichment.
- Audit log export (JSON / CSV for SIEM).
- Audit chain verification endpoint.
- TOTP MFA end-to-end UI.
- Password reset flow.

### Phase 3 — v0.3.0 (medium-term, ~12 weeks)
- Anomaly detection (failed-login bursts, new-country, off-hours) — basic ML / stats rules.
- User invitation flow (email link).
- Asset tags + filter.
- Scheduled reports (daily/weekly PDF).
- Multi-org (tenants).

### Phase 4 — v1.0.0 (longer-term, ~24 weeks)
- SOC 2 Type II evidence pack.
- Terraform provider for asset import.
- Bulk import (CSV).
- Time-bounded Viewer accounts (auditor flow).
- Windows / RDP collector.
- Process / network collector (eBPF) — exploratory.

### Backlog (no firm date)
- Mobile-optimized dashboard.
- i18n (Indonesian, Bahasa Melayu, etc.).
- Public status page (read-only mode).
- Kubernetes operator / Helm chart.

---

## 14. Success Metrics

| Metric | Definition | v1 Target |
|--------|-----------|-----------|
| **MAU (self-hosted installs reporting health)** | Unique instances pinging `/api/health` in 30d | 200 |
| **Time-to-first-event** | From `docker compose up` to first event visible on dashboard | < 15 min |
| **Auth-event coverage** | % of customer's monitored assets that have seen an event in last 24h | > 95% |
| **MTTR for failed login storm** | From first failed login to alert acknowledged | < 5 min |
| **Critical CVE patch latency** | Time from CVE disclosure to patched release | < 14 days |
| **Customer-reported false-positive rate** | % of alerts dismissed as false positive | < 20% |
| **Container size** | Uncompressed app image | < 250 MB |
| **Time-to-deploy** | Cold `git clone && docker compose up -d` to working dashboard | < 10 min |

---

## 15. Risks & Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | Collector credentials leak (SSH key / DB password) | Low | Critical | Encrypted at rest with AES-256-GCM; never sent to client; audited decrypt |
| R2 | Audit log tampering by attacker with DB access | Low | Critical | Hash chain + (future) optional write-once storage / off-host sink |
| R3 | Brute-force login against OpenShield itself | Medium | High | Rate limit + lockout + Argon2id + (future) MFA + fail2ban-friendly |
| R4 | SSRF via collector target field | Low | High | Targets stored in DB, not from request URL; IP allowlist for outbound |
| R5 | Single-node becomes bottleneck | Medium | Medium | Horizontal scaling plan: split app + collectors; Redis-backed queue already in place |
| R6 | DB schema migration breaks audit chain | Low | High | Migrations versioned + idempotent; chain hash includes `prev_hash` only, not schema state |
| R7 | Dependency CVE (Next.js, Prisma, ssh2) | Medium | High | `npm audit` in CI; pinned versions; Dependabot enabled; renovate-ready |
| R8 | User accidentally exposes Postgres / Redis port publicly | Medium | High | Compose binds both to `127.0.0.1` by default; healthcheck reminder in `docker-compose.yml` |
| R9 | Loss of `ENCRYPTION_KEY` env → all stored credentials unreadable | Medium | Critical | Documented backup requirement; recovery procedure in `SECURITY.md` |
| R10 | Tailwind v4 / Next.js 16 churn (very new versions) | High | Medium | `AGENTS.md` warns that "this is not the Next.js you know"; pinned versions; CI catches breakage |

---

## 16. Open Questions

These need decisions before/during v0.2:

1. **License**: Currently private. Plan to open-source? If yes, MIT or AGPLv3? (AGPL would deter SaaS resellers, MIT maximizes adoption.)
2. **Telemetry**: Should self-hosted instances opt-in to anonymous usage telemetry (e.g. feature usage, error counts)? Pro: better product decisions. Con: trust cost.
3. **GeoIP data source**: MaxMind GeoLite2 (free, requires signup) vs DB-IP (CC-BY) vs offline-only (no enrichment)?
4. **Alert channels in v0.2**: Slack + Telegram + Webhook enough? Or add PagerDuty / Opsgenie?
5. **MFA UX**: TOTP only, or also WebAuthn (passkeys) for v0.3?
6. **Backup strategy**: Document only, or ship a `backup.sh` that does `pg_dump` + `redis-cli BGSAVE` + S3 upload?
7. **Internationalization**: Bahasa Indonesia at launch (given the project owner's locale) or English-first?
8. **Org model for v1**: Strict multi-tenant (separate DB schemas) or soft multi-tenant (shared DB, `orgId` filter)?

---

## 17. Appendix

### A. Glossary
- **Collector** — background worker that polls a target (SSH server / DB) for auth events.
- **Asset** — anything being monitored (SSH host or DB instance).
- **Audit log** — append-only, hash-chained log of state-changing actions.
- **RBAC** — role-based access control (Owner / Admin / Viewer).
- **SSRF** — server-side request forgery.
- **STRIDE** — Microsoft's threat-modeling taxonomy (Spoofing, Tampering, Repudiation, Information Disclosure, DoS, EoP).

### B. References
- `README.md` — quickstart
- `SECURITY.md` — full security policy, threat model, RBAC matrix, key management
- `AGENTS.md` — agent-coding conventions (Next.js 16 specific)
- `prisma/schema.prisma` — data model source of truth
- `docker-compose.yml` — deployment topology
- `.env.example` — environment variable schema

### C. Document history
| Version | Date | Author | Change |
|---------|------|--------|--------|
| 1.0 | 2026-06-18 | (generated) | Initial PRD — retrospective of v0.1.0 + forward-looking roadmap |
