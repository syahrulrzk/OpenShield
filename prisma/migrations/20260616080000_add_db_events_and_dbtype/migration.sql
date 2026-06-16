-- Add DbType enum
CREATE TYPE "DbType" AS ENUM ('NONE', 'POSTGRES', 'MYSQL', 'SQLSERVER');

-- Add DbEventStatus enum
CREATE TYPE "DbEventStatus" AS ENUM ('SUCCESS', 'FAILED', 'DENIED');

-- Add new columns to assets
ALTER TABLE "assets" ADD COLUMN "db_type" "DbType" NOT NULL DEFAULT 'NONE';
ALTER TABLE "assets" ADD COLUMN "db_host" TEXT;
ALTER TABLE "assets" ADD COLUMN "db_port" INTEGER;
ALTER TABLE "assets" ADD COLUMN "db_name" TEXT;
ALTER TABLE "assets" ADD COLUMN "db_user" TEXT;
CREATE INDEX "assets_db_type_idx" ON "assets"("db_type");

-- Drop old PG columns
ALTER TABLE "assets" DROP COLUMN "pg_host";
ALTER TABLE "assets" DROP COLUMN "pg_port";
ALTER TABLE "assets" DROP COLUMN "pg_database";
ALTER TABLE "assets" DROP COLUMN "pg_user";

-- Rename pg_enc_data -> db_enc_data in asset_credentials
ALTER TABLE "asset_credentials" RENAME COLUMN "pg_enc_data" TO "db_enc_data";
-- Drop the old FK and recreate with new name
ALTER TABLE "asset_credentials" DROP CONSTRAINT "assetcred_pg_asset_fkey";
ALTER TABLE "asset_credentials" ADD CONSTRAINT "assetcred_db_asset_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON UPDATE CASCADE ON DELETE CASCADE;

-- Drop pg_events table
DROP TABLE "pg_events";

-- Create db_events table
CREATE TABLE "db_events" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "db_type" "DbType" NOT NULL,
    "username" TEXT NOT NULL,
    "source_ip" TEXT,
    "database" TEXT,
    "status" "DbEventStatus" NOT NULL,
    "event_time" TIMESTAMP(3) NOT NULL,
    "raw" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "db_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "db_events_asset_id_event_time_idx" ON "db_events"("asset_id", "event_time");
CREATE INDEX "db_events_username_event_time_idx" ON "db_events"("username", "event_time");
CREATE INDEX "db_events_source_ip_event_time_idx" ON "db_events"("source_ip", "event_time");
CREATE INDEX "db_events_status_event_time_idx" ON "db_events"("status", "event_time");
CREATE INDEX "db_events_db_type_event_time_idx" ON "db_events"("db_type", "event_time");

ALTER TABLE "db_events" ADD CONSTRAINT "db_events_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
