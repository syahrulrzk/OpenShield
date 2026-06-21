# Agent Configuration — log_watchers

The OpenShield Python agent (`/opt/openshield-agent/agent.py`) reads log files
locally via the `LogTailer` class. Each watcher is a (path, parser) pair declared
in `/etc/openshield/agent.yaml`. Supported parsers are registered in the
`PARSERS` dict in `agent.py`.

## Available Parsers (v1.4.0+)

| Parser key        | Parses                                | Emits event(s)                                                     |
| ----------------- | ------------------------------------- | ------------------------------------------------------------------ |
| `sshd`            | SSH login/connection log              | `sshd.failed`, `sshd.success`, `sshd.session.*`, `sshd.connection` |
| `mysql_audit`     | MySQL `general_log` (FILE mode)       | `mysql.connect.success`, `mysql.connect.failed`, `mysql.disconnect`|
| `pgaudit`         | PostgreSQL `pgaudit` CONNECT events   | `pg.connect.success`, `pg.connect.failed`, `pg.disconnect`         |
| `syslog`          | Stub (disabled by default)            | —                                                                  |

> **Privacy & performance (per Bos):** DB audit parsers only capture
> **Connect / Disconnect / Access-denied** events. Query bodies, slow-query
> logs, DDL/DML, etc. are skipped — never sent to OpenShield.

---

## MySQL Audit (`mysql_audit` parser)

Monitors MySQL connection attempts by tailing the general query log.

### Setup on the MySQL server (one-time)

```sql
-- Enable general_log to file output (general_log=ON by default logs to FILE
-- unless log_output is changed). Rotate via logrotate.
SET GLOBAL log_output = 'FILE';
SET GLOBAL general_log  = 'ON';

-- Optional but recommended: cap rotation size
SET GLOBAL general_log_file = '/var/lib/mysql/audit.log';

-- Agent runs as user 'openshield-agent' (member of `adm` group) which can
-- read /var/lib/mysql/<hostname>.log via the `mysql` group. If you change
-- log path, update both permissions AND agent.yaml.
```

### `agent.yaml` block

```yaml
log_watchers:
  - name: mysql_audit
    path: /var/lib/mysql/audit.log       # path from general_log_file
    parser: mysql_audit
```

### Emitted events

| `raw_data.event`        | When                                              | Severity |
| ----------------------- | ------------------------------------------------- | -------- |
| `mysql.connect.success` | `Connect <user>@<host> on <db> using <proto>`      | INFO     |
| `mysql.connect.failed`  | `Connect Access denied for user 'X'@'Y' ...`     | ERROR    |
| `mysql.disconnect`      | `Quit` (no user/IP in line — minimal event)       | INFO     |

Query / Init / Statistics lines are silently skipped.

### Notes

- `log_output='TABLE'` writes to `mysql.general_log` instead of a file.
  That path is consumed **server-side** by the OpenShield `pollMysqlAuditLog`
  (see Asset `auditConnectionLog` flag). Use the **FILE** mode + agent for
  the path described here.
- The agent only needs **read** access to the file. No MySQL credentials.
- Multiple MySQL instances on one host: add one watcher per log path.

---

## PostgreSQL Audit (`pgaudit` parser)

Monitors PostgreSQL connection events by tailing pgaudit output.

### Setup on the PostgreSQL server (one-time)

```bash
# 1. Install the pgaudit extension (Debian/Ubuntu)
sudo apt install postgresql-16-pgaudit

# 2. Configure shared_preload_libraries
echo "shared_preload_libraries = 'pgaudit'" \
  | sudo tee -a /etc/postgresql/16/main/postgresql.conf

# 3. Restart PostgreSQL
sudo systemctl restart postgresql

# 4. Enable per-database
sudo -u postgres psql -d mydb -c "CREATE EXTENSION IF NOT EXISTS pgaudit;"

# 5. Configure what to log (postgresql.conf or ALTER SYSTEM)
ALTER SYSTEM SET pgaudit.log = 'connection';   -- only connect/disconnect
-- For more: 'ddl, role, write, read'  (but parser will still only emit CONNECT/DISCONNECT)
SELECT pg_reload_conf();
```

### `agent.yaml` block

```yaml
log_watchers:
  - name: pgaudit
    path: /var/log/postgresql/postgresql-16-main.log   # check actual path on your distro
    parser: pgaudit
```

### Emitted events

| `raw_data.event`        | When                                          | Severity |
| ----------------------- | --------------------------------------------- | -------- |
| `pg.connect.success`    | `AUDIT: SESSION,..,CONNECT`                   | INFO     |
| `pg.connect.failed`     | `AUDIT: SESSION,..,FAILED_AUTH` (pgaudit ≥16) | ERROR    |
| `pg.disconnect`         | `AUDIT: SESSION,..,DISCONNECT`                | INFO     |

READ / WRITE / DDL / ROLE events are silently skipped (privacy + perf).

### Notes

- pgaudit with `pgaudit.log='connection'` is the **recommended minimum**.
  Setting it to `'ddl, role, write, read'` adds verbosity but the parser still
  filters down to CONNECT / DISCONNECT events only.
- For PostgreSQL logs on RHEL/Fedora: `/var/log/pgsql/*/pg_log/*.log` or
  via journald (`journalctl -u postgresql -f` → forward to file with
  `tee` + `logrotate`).
- The agent needs **read** access to the log file (member of `adm` group).

---

## Auditd (Linux Kernel Audit)

Added in **v1.5.0**. Tails `/var/log/audit/audit.log` for high-signal events:

- `USER_LOGIN`, `USER_LOGOUT`, `USER_START`, `USER_END`
- `USER_AUTH`, `USER_ACCT`
- `LOGIN`, `LOGOUT` (tty sessions)
- `SERVICE_START`, `SERVICE_STOP` (systemd units)
- `CONFIG_CHANGE` (audit rule changes)
- `SYSCALL` — filtered to keys: `sudo_use`, `su_use`, `passwd_changes`,
  `shadow_changes`, `sudoers_changes`, `sshd_config_changes`, `time_change`

Setup on target host:

```bash
apt install auditd
systemctl enable --now auditd

# Recommended rules (append to /etc/audit/rules.d/openshield.rules)
cat > /etc/audit/rules.d/openshield.rules << 'EOF'
-w /etc/passwd -p wa -k passwd_changes
-w /etc/shadow -p wa -k shadow_changes
-w /etc/sudoers -p wa -k sudoers_changes
-w /etc/ssh/sshd_config -p wa -k sshd_config_changes
-a always,exit -F path=/usr/bin/sudo -F perm=x -k sudo_use
-a always,exit -F path=/usr/bin/su -F perm=x -k su_use
EOF

auditctl -R /etc/audit/rules.d/openshield.rules
# Or: systemctl restart auditd  (reads rules.d/*.rules)
```

The agent needs `SupplementaryGroups=adm` in systemd unit (already set)
to read `/var/log/audit/audit.log` (mode 0640 root:adm).

Dashboard: `/dashboard/events/auditd` — filterable by auditd type, severity, range.

---

## Adding a new parser

1. Implement a class with `parse(self, line: str) -> Optional[Dict[str, Any]]`
   in `agent.py` (mirror `MysqlAuditParser`).
2. Register in the `PARSERS` dict.
3. Bump `VERSION` in 3 places (`agent.py`, `agent-versions.ts`, restart dev).
4. Run `npm run check-agent` to confirm sync.

See `docs/agent-sync.md` for the full release workflow.