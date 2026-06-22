--> statement-breakpoint
ALTER TABLE t_event_log_syslog
  ADD COLUMN event_type    TEXT,
  ADD COLUMN "user"        TEXT,
  ADD COLUMN source_ip     TEXT,
  ADD COLUMN description   TEXT,
  ADD COLUMN agent_name    TEXT,
  ADD COLUMN facility      INTEGER,
  ADD COLUMN priority      INTEGER,
  ADD COLUMN auth_detected BOOLEAN,
  ADD COLUMN service       TEXT,
  ADD COLUMN port          INTEGER;

--> statement-breakpoint
UPDATE t_event_log_syslog
SET
  event_type    = COALESCE(raw_data->>'eventKind', 'log.line'),
  "user"        = NULLIF(raw_data->>'user', ''),
  source_ip     = NULLIF(raw_data->>'ip', ''),
  description   = COALESCE(NULLIF(raw_data->>'full_message', ''), message),
  facility      = NULLIF(raw_data->>'facility', '')::INTEGER,
  priority      = NULLIF(raw_data->>'priority', '')::INTEGER,
  auth_detected = CASE
                    WHEN raw_data->>'authDetected' = 'true' THEN TRUE
                    WHEN raw_data->>'authDetected' = 'false' THEN FALSE
                    ELSE NULL
                  END,
  service       = NULLIF(raw_data->>'service', ''),
  port          = NULLIF(raw_data->>'port', '')::INTEGER,
  agent_name    = (
    SELECT COALESCE(agents.name, agents.hostname)
    FROM agents
    WHERE agents.id = t_event_log_syslog.agent_id
  )
WHERE raw_data IS NOT NULL;

--> statement-breakpoint
UPDATE t_event_log_syslog
SET agent_name = (
  SELECT COALESCE(agents.name, agents.hostname)
  FROM agents
  WHERE agents.id = t_event_log_syslog.agent_id
)
WHERE agent_name IS NULL;

--> statement-breakpoint
UPDATE t_event_log_syslog SET description = message WHERE description IS NULL;

--> statement-breakpoint
ALTER TABLE t_event_log_syslog
  ALTER COLUMN event_type    SET NOT NULL,
  ALTER COLUMN description   SET NOT NULL,
  ALTER COLUMN event_type    SET DEFAULT 'log.line';

--> statement-breakpoint
ALTER TABLE t_event_log_syslog DROP COLUMN raw_data CASCADE;

--> statement-breakpoint
-- 2026-06-22 followup: the old `message` column was kept around in the
-- first attempt. Drop it now that `description` is the canonical column.
-- Rows where description is empty are filled from the old message first.
UPDATE t_event_log_syslog SET description = message WHERE description IS NULL OR description = '';
ALTER TABLE t_event_log_syslog DROP COLUMN message;

--> statement-breakpoint
CREATE INDEX idx_syslog_event_type_time
  ON t_event_log_syslog (event_type, event_time DESC);

--> statement-breakpoint
CREATE INDEX idx_syslog_severity_time
  ON t_event_log_syslog (severity, event_time DESC);

--> statement-breakpoint
CREATE INDEX idx_syslog_source_ip_time
  ON t_event_log_syslog (source_ip, event_time DESC)
  WHERE source_ip IS NOT NULL;

--> statement-breakpoint
CREATE INDEX idx_syslog_user_time
  ON t_event_log_syslog ("user", event_time DESC)
  WHERE "user" IS NOT NULL;

--> statement-breakpoint
CREATE INDEX idx_syslog_auth_time
  ON t_event_log_syslog (auth_detected, event_time DESC)
  WHERE auth_detected = TRUE;

--> statement-breakpoint
DROP VIEW IF EXISTS v_syslog_events;
