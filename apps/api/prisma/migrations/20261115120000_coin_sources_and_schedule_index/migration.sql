-- CreateEnum
CREATE TYPE "CoinSource" AS ENUM ('MANUAL', 'HOMEWORK', 'TEST', 'ATTENDANCE', 'ACHIEVEMENT', 'SHOP');

-- AlterTable
ALTER TABLE "CoinTransaction"
  ADD COLUMN "sourceType" "CoinSource" DEFAULT 'MANUAL',
  ADD COLUMN "sourceId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CoinTransaction_userId_sourceType_sourceId_key"
  ON "CoinTransaction"("userId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "Schedule_teacherId_startsAt_idx" ON "Schedule"("teacherId", "startsAt");
