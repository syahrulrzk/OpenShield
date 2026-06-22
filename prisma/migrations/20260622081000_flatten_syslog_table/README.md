# 2026-06-22: Flatten t_event_log_syslog

Bos wanted the syslog events table to use flat typed columns matching
the example shape:

    id | timestamp | agent | event_type | severity | user | source_ip |
    description

Previously every typed field (event_type, user, ip, facility, priority,
auth_detected, port, service, agent_name) lived inside a `raw_data` jsonb
column. Reading required post-processing on every API call.

After this migration the columns are first-class, queryable, indexable,
and the API just `SELECT`s. The new table layout:

| Column        | Type           | Notes                              |
|---------------|----------------|------------------------------------|
| id            | text           | cuid                               |
| agent_id      | text           | FK -> agents                       |
| event_time    | timestamptz    | when the event happened            |
| event_type    | text NOT NULL  | syslog.sshd, syslog.sudo, ...      |
| severity      | text           | INFO / WARN / ERROR                |
| user          | text           | extracted username (nullable)      |
| source_ip     | text           | extracted IP (nullable)            |
| description   | text NOT NULL  | full message                       |
| process       | text           | sshd, sudo, systemd, ...           |
| pid           | int            | process PID                        |
| hostname      | text           | origin host                        |
| source        | text           | log file path                      |
| agent_name    | text           | denormalized agent name (no JOIN)  |
| facility      | int            | syslog facility (0-23)             |
| priority      | int            | syslog priority (0-191)            |
| auth_detected | boolean        | flag for auth-related events       |
| service       | text           | sshd, sudo, pam, ...               |
| port          | int            | network port if mentioned          |
| count         | int            | dedup aggregation count            |
| created_at    | timestamptz    | insert time                        |

The internal-only jsonb fields lost: `_dedupSig, event, format, note,
parser, severityName, severityNum, sourceApp, timestamp_raw, full_message
(moved to description)`. None of these were surfaced in the UI.

Backfill: 438 existing rows were re-typed from `raw_data` to the new
columns in the same migration. The Postgres view `v_syslog_events` was
dropped (the base table IS the flat shape now).
