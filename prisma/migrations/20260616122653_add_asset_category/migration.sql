-- CreateEnum
CREATE TYPE "AssetCategory" AS ENUM ('SSH', 'DATABASE', 'APP');

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "category" "AssetCategory" NOT NULL DEFAULT 'SSH';

-- Backfill: existing DB-monitoring assets → category=DATABASE
UPDATE "assets" SET "category" = 'DATABASE' WHERE "db_type" != 'NONE';

-- CreateIndex
CREATE INDEX "assets_category_idx" ON "assets"("category");
