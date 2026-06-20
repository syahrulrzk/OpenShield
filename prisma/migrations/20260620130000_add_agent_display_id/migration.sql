-- AlterTable
ALTER TABLE "agents" ADD COLUMN "display_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "agents_display_id_key" ON "agents"("display_id");
