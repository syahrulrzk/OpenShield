-- OpenShield MySQL monitoring user (server-side fallback)
--
-- This script is used when OpenShield monitors a MySQL server WITHOUT
-- the on-host agent (no `mysql_audit` log watcher). In that mode, the
-- OpenShield poller queries `mysql.general_log` table directly.
--
-- If you DO have the OpenShield agent deployed on the MySQL host and
-- using the `mysql_audit` parser (recommended), you can SKIP this file —
-- the agent reads the general_log FILE, no DB credentials needed.
--
-- Usage:
--   mysql -uroot -p < docs/sql/mysql-openshield-user.sql
--
-- Required privileges:
--   PROCESS       — to read information_schema.PROCESSLIST (live sessions)
--   SELECT        — on each user DB (for polling metrics)
--   SELECT        — on mysql.general_log (for auditConnectionLog feature)
--
-- Security notes:
--   - Password: replace 'ChangeMeStrongP@ss2026!' with a strong unique one
--   - Bound to '%' so poller on another host can reach it. Restrict via
--     firewall (ufw allow from 172.16.0.0/16 to any port 3306) AND
--     bind-address. See docs/network/mysql-lan-expose.md.
--   - Read-only. NO DDL/DML grants. NO GRANT OPTION.

CREATE USER IF NOT EXISTS 'openshield'@'%'
  IDENTIFIED BY 'ChangeMeStrongP@ss2026!';

-- Processlist access (for login session polling)
GRANT PROCESS ON *.* TO 'openshield'@'%';

-- Per-database read access (replace `mydb` with your actual DB name).
-- Repeat for each DB you want OpenShield to monitor.
GRANT SELECT ON `mydb`.* TO 'openshield'@'%';

-- Server-side audit log access (only needed if using auditConnectionLog
-- without the on-host agent). If you use the agent + mysql_audit parser,
-- this GRANT is optional.
GRANT SELECT ON `mysql`.`general_log` TO 'openshield'@'%';

FLUSH PRIVILEGES;

-- Verify
SHOW GRANTS FOR 'openshield'@'%';