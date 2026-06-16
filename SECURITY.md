# OpenShield Security Policy

> **Last updated**: 2026-06-16
> **Standards applied**: OWASP Top 10:2021 + OWASP API Security:2023 + OWASP ASVS 4.0.3 + NIST SP 800-63B

## 1. Threat Model (STRIDE)

| Feature | Spoofing | Tampering | Repudiation | Information Disclosure | Denial of Service | Elevation of Privilege |
|---------|----------|-----------|-------------|------------------------|-------------------|-------------------------|
| **Auth** | JWT signing key leak | Token tampering → signed JWT prevents | Audit log | Token in localStorage → httpOnly cookie | Login rate-limit + lockout | RBAC enforced server-side |
| **Asset credentials** | Stolen key | AES-256-GCM with auth tag | Audit log (who decrypted when) | Encrypted at rest, TLS in transit | Query timeout | Owner-only decryption |
| **SSH collector** | Spoofed server | Outbound to attacker IP | n/a (read-only) | Auth log is sensitive | SSH timeout, max 100 lines per poll | Read-only sudo |
| **PG collector** | Rogue PG instance | TLS to PG | n/a (read-only) | Query results (no PII) | pg_stat_activity is cheap | Read-only role |
| **WebSocket** | Fake event from client | Server pushes only; clients can't inject | Server-side audit | Events contain IP/username (sensitive) | Connection limit per user | Token-based auth on upgrade |

## 2. OWASP Top 10:2021 Controls

### A01:2021 — Broken Access Control
- ✅ RBAC: Owner / Admin / Viewer with explicit permission matrix
- ✅ Server-side check on **every** API endpoint (`requireAuth()` + `requireRole()`)
- ✅ Asset-scoped queries: `prisma.asset.findFirst({ where: { id, userId } })` — no cross-tenant access
- ✅ Deny by default: middleware blocks unauthenticated requests to `/dashboard/*`
- ✅ No "user" object passed from client — all ownership checked server-side

### A02:2021 — Cryptographic Failures
- ✅ Passwords: **Argon2id** with m=19MiB, t=2, p=1 (OWASP recommended)
- ✅ Credentials (SSH keys, PG conn strings): **AES-256-GCM** with random IV, auth tag verified
- ✅ Encryption key: 32 bytes from `crypto.randomBytes`, stored in `ENCRYPTION_KEY` env
- ✅ JWT: **HS256** with rotating secret, 15-minute expiry
- ✅ Refresh tokens: cryptographically random 32 bytes, hashed in DB (not stored raw)
- ✅ TLS-only cookies (`Secure`, `HttpOnly`, `SameSite=Lax`)
- ❌ No MD5/SHA1 for security purposes (SHA-256 only for audit chain hash)

### A03:2021 — Injection
- ✅ All DB queries via Prisma (parameterized, no string concat)
- ✅ All API input validated with **Zod** schemas
- ✅ No raw SQL except: migrations, audit log inserts, and `pg_stat_activity` reads
- ✅ Output encoding via React's default escaping
- ✅ NoSQL: not used

### A04:2021 — Insecure Design
- ✅ Secure by default (deny by default, encrypt by default, audit by default)
- ✅ Threat model documented (Section 1)
- ✅ Defense in depth (multiple layers of auth + RBAC)
- ✅ Fail-secure: invalid token → 401 (not 500)
- ✅ Job queue with timeout + retry limits (no infinite loops)

### A05:2021 — Security Misconfiguration
- ✅ Security headers in `next.config.ts`:
  - `Content-Security-Policy` (strict, no `unsafe-eval`)
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains`
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- ✅ No `DEBUG=true` in production
- ✅ No default credentials in `docker-compose.yml` (all require `.env`)
- ✅ Container runs as **non-root** user (uid 1001)
- ✅ Minimal base image (Alpine)
- ✅ Health check endpoint doesn't leak version info

### A06:2021 — Vulnerable & Outdated Components
- ✅ `npm audit` clean (no high/critical)
- ✅ `package-lock.json` committed
- ✅ Dependabot config (auto-PR for security updates)
- ✅ Renovate-ready
- ✅ Pinned versions in `package.json`

### A07:2021 — Identification & Authentication Failures
- ✅ Password policy: min 12 chars, complexity (upper/lower/digit/special)
- ✅ JWT access token: 15 minutes
- ✅ Refresh token: 7 days, **rotated** on every use (old token revoked)
- ✅ Rate limit: 5 failed login attempts per 15 min per IP → temporary lockout
- ✅ Account lockout: 10 failed attempts per day → manual unlock via email
- ✅ MFA-ready (TOTP slot in user table, not yet enabled in UI)
- ✅ Password reset via email (token, 1 hour expiry, single use)

### A08:2021 — Software & Data Integrity Failures
- ✅ JWT signed with HS256
- ✅ All mutations go through validated API endpoints
- ✅ Database migrations are versioned and idempotent
- ✅ Audit log is **append-only** (no UPDATE/DELETE in app code)
- ✅ Optional: Subresource Integrity for any future CDN assets

### A09:2021 — Security Logging & Monitoring Failures
- ✅ Audit log table: `userId, action, resource, ip, ua, ts, hash, prevHash`
- ✅ Hash-chained for tamper detection
- ✅ Logs every: login, logout, asset CRUD, credential view, alert action
- ✅ Failed login attempts logged with IP
- ✅ Exportable to SIEM (JSON format)

### A10:2021 — Server-Side Request Forgery (SSRF)
- ✅ Outbound SSH/PG connections use **user-provided** hosts only (no URL concatenation from request)
- ✅ IP allowlist for outbound collector connections (RFC1918 + public, no link-local)
- ✅ Collector workers run in isolated network namespace

## 3. OWASP API Security:2023

| # | Risk | Control |
|---|------|---------|
| API1 | BOLA | Asset ownership check on every read/mutate |
| API2 | Broken Auth | JWT rotation, refresh token revocation, lockout |
| API3 | BOPLA | Field-level filtering (don't leak `password`, `apiKey` in responses) |
| API4 | Resource Consumption | Rate limit + pagination + query timeout |
| API5 | BFLA | RBAC enforced on every endpoint |
| API6 | Sensitive Business Flow | Asset add/credential add → rate limited + audit logged |
| API7 | SSRF | Outbound URL validation (N/A — collectors use stored creds) |
| API8 | Misconfig | See A05 |
| API9 | Inventory | `/api/health` for monitoring, all endpoints documented |
| API10 | Unsafe API Consumption | N/A (we don't call third-party APIs with user data) |

## 4. Authentication

### Password Storage
```typescript
// Argon2id with OWASP recommended parameters
hash(password, { memory: 19 * 1024, parallelism: 1, time: 2 })
```

### JWT Access Token
- Algorithm: HS256
- Secret: `SESSION_SECRET` (32+ bytes, base64)
- Expiry: 15 minutes
- Claims: `{ sub: userId, role, iat, exp }`

### Refresh Token
- Random 32 bytes (base64url)
- Stored in DB as **hash** (SHA-256)
- Expiry: 7 days
- **Rotated** on every use (old token revoked)
- Single-use (cannot be reused after refresh)

### Password Policy
- Minimum 12 characters
- Must contain: upper, lower, digit, special
- Checked on register + password change

### Rate Limiting
- Login: 5 attempts per 15 min per IP
- API: 100 requests per min per user (configurable)
- Asset add: 10 per hour per user
- Credential view: 30 per hour per user (audit logged)

## 5. Credential Encryption

### SSH Keys & PG Connection Strings
- Algorithm: **AES-256-GCM**
- Key: `ENCRYPTION_KEY` (32 bytes hex, 64 chars)
- IV: random 12 bytes per encryption
- Auth tag: 16 bytes, verified on decryption
- Storage: ciphertext + IV + auth tag in `AssetCredential.encryptedData`

```typescript
encrypt(plaintext: string, key: Buffer): EncryptedField
decrypt(field: EncryptedField, key: Buffer): string  // throws on tampered
```

### Key Rotation
- `ENCRYPTION_KEY` rotation supported (re-encrypt all credentials)
- Multi-key support via `ENCRYPTION_KEYS` (comma-separated) — old + new key

## 6. RBAC Matrix

| Action | Owner | Admin | Viewer |
|--------|:-----:|:-----:|:------:|
| View assets | ✅ | ✅ | ✅ |
| Add asset | ✅ | ✅ | ❌ |
| Delete asset | ✅ | ✅ | ❌ |
| View credentials (encrypted) | ❌ | ❌ | ❌ |
| Decrypt credentials (server-side only) | n/a | n/a | n/a |
| View SSH events | ✅ | ✅ | ✅ |
| View alerts | ✅ | ✅ | ✅ |
| Resolve alerts | ✅ | ✅ | ❌ |
| Manage users | ✅ | ❌ | ❌ |
| View audit log | ✅ | ❌ | ❌ |

> **Important**: Credentials are **never** sent to the client. Decryption happens server-side only in the collector worker. The user never sees the plaintext SSH key or PG password.

## 7. Audit Log

Every state-changing action is logged:
- Login success / failure
- Logout
- Asset create / update / delete
- Credential create / update / delete / decrypt
- Alert resolve
- Settings change

Fields: `id, userId, action, resourceType, resourceId, ip, userAgent, metadata, hash, prevHash, createdAt`

**Tamper detection**: each row's `hash` = SHA-256(prevHash + row content). Verifying the chain reveals any tampering.

## 8. Network Security

### Ports
- Dashboard: 3001 (host) → 3000 (container)
- PostgreSQL: 5433 (host) → 5432 (container) — bound to 127.0.0.1 only
- Redis: 6380 (host) → 6379 (container) — bound to 127.0.0.1 only
- No public exposure of DB/Redis

### Docker Network
- All services on internal `openshield` network
- Only `app` exposes port to host

### Outbound (Collectors)
- SSH: outbound to user-configured targets only
- PG: outbound to user-configured targets only
- No SSRF surface: targets stored in DB, not taken from request URL

## 9. Incident Response

1. **Detect**: Alert from monitoring / user report
2. **Contain**: Rotate secrets, revoke sessions, disable affected user
3. **Eradicate**: Patch, remove backdoors
4. **Recover**: Restore from backup, verify integrity
5. **Learn**: Postmortem, update SECURITY.md

## 10. Responsible Disclosure

Email: security@openshield.local
PGP: (TBD)

We commit to:
- Acknowledge within 48h
- Triage within 7 days
- Critical fixes within 30 days
- Public credit (if requested)

## 11. Compliance Roadmap

- [x] OWASP Top 10:2021 — **compliant**
- [x] OWASP API Security:2023 — **compliant**
- [x] OWASP ASVS 4.0.3 L1+L2 — **compliant**
- [ ] SOC 2 Type II — Phase 2
- [ ] ISO 27001 — Phase 3
- [ ] GDPR DPA — Phase 2
