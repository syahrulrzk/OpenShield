-- CreateEnum
CREATE TYPE "Environment" AS ENUM ('PROD', 'STAGING', 'UAT', 'DEV', 'DR');

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "environment" "Environment" NOT NULL DEFAULT 'PROD';

-- CreateIndex
CREATE INDEX "assets_environment_idx" ON "assets"("environment");
