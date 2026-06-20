-- Narrow Environment enum from {PROD,STAGING,UAT,DEV,DR} to {PROD,STAGING,UAT}
-- Dropped: DEV (Development), DR (Disaster Recovery) — see scripts/narrow-env.ts
-- for the one-off DDL applied to existing DB. This migration documents the
-- final state so fresh installs (prisma migrate deploy) get the right enum.

-- Recreate enum with 3 values (only if old type still has 5 — safe re-run)
DO $$
BEGIN
  -- If old 5-value enum still exists, drop it and replace
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'Environment'
      AND e.enumlabel IN ('DEV', 'DR')
  ) THEN
    ALTER TABLE "agents" ALTER COLUMN "environment" DROP DEFAULT;
    ALTER TABLE "assets" ALTER COLUMN "environment" DROP DEFAULT;

    CREATE TYPE "Environment_narrow" AS ENUM ('PROD', 'STAGING', 'UAT');

    ALTER TABLE "agents" ALTER COLUMN "environment"
      TYPE "Environment_narrow" USING ("environment"::text::"Environment_narrow");
    ALTER TABLE "agents" ALTER COLUMN "environment" SET DEFAULT 'PROD';

    ALTER TABLE "assets" ALTER COLUMN "environment"
      TYPE "Environment_narrow" USING ("environment"::text::"Environment_narrow");
    ALTER TABLE "assets" ALTER COLUMN "environment" SET DEFAULT 'PROD';

    DROP TYPE "Environment";
    ALTER TYPE "Environment_narrow" RENAME TO "Environment";
  END IF;
END $$;
