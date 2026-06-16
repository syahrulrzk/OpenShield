CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- Seed default settings
INSERT INTO "system_settings" ("key", "value", "updated_at", "created_at") VALUES
  ('registration_enabled', 'true', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('alert_min_severity', '"MEDIUM"', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('webhook_enabled', 'false', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('webhook_url', '""', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
