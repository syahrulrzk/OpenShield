-- ============================================================
-- SPLIT EVENT LOGS INTO 6 PER-TYPE TABLES
-- 2026-06-21
-- ============================================================
-- Bos directive: replace 3 generic tables (agent_events, server_events,
-- db_events) with 6 specialized per-type tables for cleaner separation,
-- per-type retention/backup, and tighter indexes.
--
-- Migration strategy:
--   1. CREATE new 6 tables + indexes + FKs
--   2. INSERT ... SELECT FROM old tables, with field remapping
--   3. DROP old 3 tables
-- All in one transaction (implicit in single migration file).
-- ============================================================

-- ============================================================
-- 1. CREATE NEW TABLES
-- ============================================================

-- t_event_log_syslog
CREATE TABLE "t_event_log_syslog" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "source" TEXT NOT NULL,
    "process" TEXT,
    "pid" INTEGER,
    "hostname" TEXT,
    "message" TEXT NOT NULL,
    "raw_data" JSONB,
    "event_time" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_event_log_syslog_pkey" PRIMARY KEY ("id")
);

-- t_event_log_server_auth
CREATE TABLE "t_event_log_server_auth" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT,
    "asset_id" TEXT,
    "username" TEXT NOT NULL,
    "source_ip" TEXT NOT NULL,
    "status" "ServerStatus" NOT NULL,
    "method" TEXT,
    "country" TEXT,
    "event_time" TIMESTAMP(3) NOT NULL,
    "raw" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_event_log_server_auth_pkey" PRIMARY KEY ("id")
);

-- t_event_log_fim
CREATE TABLE "t_event_log_fim" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'WARN',
    "action" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "old_hash" TEXT,
    "new_hash" TEXT,
    "size" BIGINT,
    "mode" TEXT,
    "owner" TEXT,
    "file_time" TIMESTAMP(3),
    "message" TEXT NOT NULL,
    "raw_data" JSONB,
    "event_time" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_event_log_fim_pkey" PRIMARY KEY ("id")
);

-- t_event_log_auditd
CREATE TABLE "t_event_log_auditd" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "event_type" TEXT NOT NULL,
    "type_code" INTEGER,
    "process" TEXT,
    "pid" INTEGER,
    "uid" TEXT,
    "euid" TEXT,
    "message" TEXT NOT NULL,
    "raw_data" JSONB,
    "event_time" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_event_log_auditd_pkey" PRIMARY KEY ("id")
);

-- t_event_log_apps
CREATE TABLE "t_event_log_apps" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "app_name" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "username" TEXT,
    "source_ip" TEXT,
    "database" TEXT,
    "message" TEXT NOT NULL,
    "raw_data" JSONB,
    "event_time" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_event_log_apps_pkey" PRIMARY KEY ("id")
);

-- t_event_log_database
CREATE TABLE "t_event_log_database" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "db_type" "DbType" NOT NULL,
    "username" TEXT NOT NULL,
    "source_ip" TEXT,
    "database" TEXT,
    "status" "DbEventStatus" NOT NULL,
    "event_time" TIMESTAMP(3) NOT NULL,
    "raw" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_event_log_database_pkey" PRIMARY KEY ("id")
);

-- ============================================================
-- 2. CREATE INDEXES (matching Prisma schema)
-- ============================================================

-- t_event_log_syslog indexes
CREATE INDEX "t_event_log_syslog_agent_id_event_time_idx" ON "t_event_log_syslog"("agent_id", "event_time" DESC);
CREATE INDEX "t_event_log_syslog_severity_event_time_idx" ON "t_event_log_syslog"("severity", "event_time" DESC);
CREATE INDEX "t_event_log_syslog_process_event_time_idx" ON "t_event_log_syslog"("process", "event_time" DESC);
CREATE INDEX "t_event_log_syslog_source_event_time_idx" ON "t_event_log_syslog"("source", "event_time" DESC);

-- t_event_log_server_auth indexes
CREATE INDEX "t_event_log_server_auth_asset_id_event_time_idx" ON "t_event_log_server_auth"("asset_id", "event_time" DESC);
CREATE INDEX "t_event_log_server_auth_agent_id_event_time_idx" ON "t_event_log_server_auth"("agent_id", "event_time" DESC);
CREATE INDEX "t_event_log_server_auth_source_ip_event_time_idx" ON "t_event_log_server_auth"("source_ip", "event_time" DESC);
CREATE INDEX "t_event_log_server_auth_status_event_time_idx" ON "t_event_log_server_auth"("status", "event_time" DESC);
CREATE INDEX "t_event_log_server_auth_username_event_time_idx" ON "t_event_log_server_auth"("username", "event_time" DESC);

-- t_event_log_fim indexes
CREATE INDEX "t_event_log_fim_agent_id_event_time_idx" ON "t_event_log_fim"("agent_id", "event_time" DESC);
CREATE INDEX "t_event_log_fim_path_event_time_idx" ON "t_event_log_fim"("path", "event_time" DESC);
CREATE INDEX "t_event_log_fim_action_event_time_idx" ON "t_event_log_fim"("action", "event_time" DESC);
CREATE INDEX "t_event_log_fim_severity_event_time_idx" ON "t_event_log_fim"("severity", "event_time" DESC);

-- t_event_log_auditd indexes
CREATE INDEX "t_event_log_auditd_agent_id_event_time_idx" ON "t_event_log_auditd"("agent_id", "event_time" DESC);
CREATE INDEX "t_event_log_auditd_event_type_event_time_idx" ON "t_event_log_auditd"("event_type", "event_time" DESC);
CREATE INDEX "t_event_log_auditd_severity_event_time_idx" ON "t_event_log_auditd"("severity", "event_time" DESC);

-- t_event_log_apps indexes
CREATE INDEX "t_event_log_apps_agent_id_event_time_idx" ON "t_event_log_apps"("agent_id", "event_time" DESC);
CREATE INDEX "t_event_log_apps_app_name_event_time_idx" ON "t_event_log_apps"("app_name", "event_time" DESC);
CREATE INDEX "t_event_log_apps_event_event_time_idx" ON "t_event_log_apps"("event", "event_time" DESC);
CREATE INDEX "t_event_log_apps_severity_event_time_idx" ON "t_event_log_apps"("severity", "event_time" DESC);
CREATE INDEX "t_event_log_apps_username_event_time_idx" ON "t_event_log_apps"("username", "event_time" DESC);
CREATE INDEX "t_event_log_apps_source_ip_event_time_idx" ON "t_event_log_apps"("source_ip", "event_time" DESC);

-- t_event_log_database indexes
CREATE INDEX "t_event_log_database_asset_id_event_time_idx" ON "t_event_log_database"("asset_id", "event_time" DESC);
CREATE INDEX "t_event_log_database_username_event_time_idx" ON "t_event_log_database"("username", "event_time" DESC);
CREATE INDEX "t_event_log_database_source_ip_event_time_idx" ON "t_event_log_database"("source_ip", "event_time" DESC);
CREATE INDEX "t_event_log_database_status_event_time_idx" ON "t_event_log_database"("status", "event_time" DESC);
CREATE INDEX "t_event_log_database_db_type_event_time_idx" ON "t_event_log_database"("db_type", "event_time" DESC);

-- ============================================================
-- 3. ADD FOREIGN KEYS
-- ============================================================

ALTER TABLE "t_event_log_syslog" ADD CONSTRAINT "t_event_log_syslog_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "t_event_log_server_auth" ADD CONSTRAINT "t_event_log_server_auth_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "t_event_log_server_auth" ADD CONSTRAINT "t_event_log_server_auth_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "t_event_log_fim" ADD CONSTRAINT "t_event_log_fim_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "t_event_log_auditd" ADD CONSTRAINT "t_event_log_auditd_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "t_event_log_apps" ADD CONSTRAINT "t_event_log_apps_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "t_event_log_database" ADD CONSTRAINT "t_event_log_database_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- 4. DATA MIGRATION — move existing rows to new tables
-- ============================================================

-- 4a. agent_events WHERE parser='syslog' → t_event_log_syslog
-- Map fields: process/pid/hostname extracted from raw_data JSONB
INSERT INTO "t_event_log_syslog" (
    "id", "agent_id", "severity", "source", "process", "pid", "hostname",
    "message", "raw_data", "event_time", "count", "created_at"
)
SELECT
    ae."id",
    ae."agent_id",
    ae."severity",
    ae."source",
    ae."raw_data"->>'process',
    CASE WHEN ae."raw_data"->>'pid' ~ '^[0-9]+$'
         THEN (ae."raw_data"->>'pid')::integer
         ELSE NULL END,
    ae."raw_data"->>'hostname',
    ae."message",
    ae."raw_data",
    ae."event_time",
    ae."count",
    ae."created_at"
FROM "agent_events" ae
WHERE ae."raw_data"->>'parser' = 'syslog';

-- 4b. agent_events WHERE parser='sshd' → t_event_log_server_auth
-- status derived from raw_data->event (sshd.accepted/conn_closed = SUCCESS, etc)
-- username/ip extracted from raw_data (sometimes null)
INSERT INTO "t_event_log_server_auth" (
    "id", "agent_id", "asset_id", "username", "source_ip", "status",
    "method", "country", "event_time", "raw", "count", "created_at"
)
SELECT
    ae."id",
    ae."agent_id",
    NULL,
    -- username: prefer raw_data->user, fall back to '_unknown'
    COALESCE(NULLIF(ae."raw_data"->>'user', ''), '_unknown'),
    -- source_ip: prefer raw_data->ip, fall back to '_unknown' (NOT NULL constraint)
    COALESCE(NULLIF(ae."raw_data"->>'ip', ''), '_unknown'),
    -- status: map event type
    CASE
        WHEN ae."raw_data"->>'event' IN ('sshd.accepted', 'sshd.session_open') THEN 'SUCCESS'::"ServerStatus"
        WHEN ae."raw_data"->>'event' IN ('sshd.failed_password', 'sshd.failed_publickey', 'sshd.invalid_user') THEN 'FAILED'::"ServerStatus"
        WHEN ae."raw_data"->>'event' IN ('sshd.connection', 'sshd.conn_closed', 'sshd.sftp_session', 'sshd.command_session') THEN 'SUCCESS'::"ServerStatus"
        ELSE 'SUCCESS'::"ServerStatus"
    END,
    ae."raw_data"->>'method',
    ae."raw_data"->>'country',
    ae."event_time",
    ae."message",
    ae."count",
    ae."created_at"
FROM "agent_events" ae
WHERE ae."raw_data"->>'parser' = 'sshd';

-- 4c. agent_events WHERE parser='mysql_audit' (and future pg_audit etc) → t_event_log_apps
-- app_name from raw_data->service, event from raw_data->event
INSERT INTO "t_event_log_apps" (
    "id", "agent_id", "app_name", "event", "severity",
    "username", "source_ip", "database", "message", "raw_data",
    "event_time", "count", "created_at"
)
SELECT
    ae."id",
    ae."agent_id",
    -- app_name: prefer raw_data->service (e.g. "MYSQL"), lowercased
    LOWER(COALESCE(NULLIF(ae."raw_data"->>'service', ''), 'unknown')),
    -- event: prefer raw_data->event (e.g. "mysql.connect.success")
    COALESCE(NULLIF(ae."raw_data"->>'event', ''), 'log.line'),
    ae."severity",
    ae."raw_data"->>'username',
    ae."raw_data"->>'source_ip',
    ae."raw_data"->>'database',
    ae."message",
    ae."raw_data",
    ae."event_time",
    ae."count",
    ae."created_at"
FROM "agent_events" ae
WHERE ae."raw_data"->>'parser' IN ('mysql_audit', 'pg_audit', 'redis_audit', 'nginx_audit', 'apache_audit');

-- 4d. server_events → t_event_log_server_auth (asset-side, preserve fields)
INSERT INTO "t_event_log_server_auth" (
    "id", "agent_id", "asset_id", "username", "source_ip", "status",
    "method", "country", "event_time", "raw", "count", "created_at"
)
SELECT
    se."id",
    NULL,
    se."asset_id",
    se."username",
    se."source_ip",
    se."status",
    se."method",
    se."country",
    se."event_time",
    se."raw",
    se."count",
    se."created_at"
FROM "server_events" se;

-- 4e. db_events → t_event_log_database (field-name mapping: db_type → dbType, source_ip → sourceIp)
INSERT INTO "t_event_log_database" (
    "id", "asset_id", "db_type", "username", "source_ip", "database",
    "status", "event_time", "raw", "count", "created_at"
)
SELECT
    de."id",
    de."asset_id",
    de."db_type"::"DbType",
    de."username",
    de."source_ip",
    de."database",
    de."status"::"DbEventStatus",
    de."event_time",
    de."raw",
    de."count",
    de."created_at"
FROM "db_events" de;

-- ============================================================
-- 5. DROP OLD TABLES
-- ============================================================

DROP TABLE "agent_events";
DROP TABLE "server_events";
DROP TABLE "db_events";
