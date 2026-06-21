-- Add source tracking columns to t_event_log_server_auth
ALTER TABLE "t_event_log_server_auth"
  ADD COLUMN "source_file" TEXT,
  ADD COLUMN "source_port" INTEGER,
  ADD COLUMN "service" TEXT;
