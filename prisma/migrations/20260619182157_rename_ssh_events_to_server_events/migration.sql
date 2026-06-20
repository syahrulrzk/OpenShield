-- Rename ssh_events table to server_events
ALTER TABLE IF EXISTS "ssh_events" RENAME TO "server_events";

-- Rename indexes
ALTER INDEX IF EXISTS "ssh_events_asset_id_event_time_idx" RENAME TO "server_events_asset_id_event_time_idx";
ALTER INDEX IF EXISTS "ssh_events_source_ip_event_time_idx" RENAME TO "server_events_source_ip_event_time_idx";
ALTER INDEX IF EXISTS "ssh_events_status_event_time_idx" RENAME TO "server_events_status_event_time_idx";

-- Rename enum (PostgreSQL)
ALTER TYPE "SshStatus" RENAME TO "ServerStatus";
