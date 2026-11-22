-- CreateEnum
CREATE TYPE "CoinTransactionStatus" AS ENUM ('POSTED', 'PENDING', 'REJECTED', 'REVERSED', 'APPEALED');

-- CreateEnum
CREATE TYPE "CoinAppealStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CoinQuestPeriod" AS ENUM ('DAILY', 'WEEKLY', 'SEASON');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CoinSource" ADD VALUE 'QUEST';
ALTER TYPE "CoinSource" ADD VALUE 'STREAK';
ALTER TYPE "CoinSource" ADD VALUE 'SEASON';
ALTER TYPE "CoinSource" ADD VALUE 'EVENT';
ALTER TYPE "CoinSource" ADD VALUE 'PENALTY';
ALTER TYPE "CoinSource" ADD VALUE 'REFUND';
ALTER TYPE "CoinSource" ADD VALUE 'REVERSAL';
ALTER TYPE "CoinSource" ADD VALUE 'LEVEL';
ALTER TYPE "CoinSource" ADD VALUE 'ADJUSTMENT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ShopOrderStatus" ADD VALUE 'READY';
ALTER TYPE "ShopOrderStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "Achievement" ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'GENERAL',
ADD COLUMN     "collection" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "rarity" TEXT NOT NULL DEFAULT 'COMMON',
ADD COLUMN     "rewardCoins" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "CoinTransaction" ADD COLUMN     "balanceAfter" INTEGER,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "reversedAt" TIMESTAMP(3),
ADD COLUMN     "reversedById" TEXT,
ADD COLUMN     "status" "CoinTransactionStatus" NOT NULL DEFAULT 'POSTED';

-- AlterTable
ALTER TABLE "ShopOrder" ADD COLUMN     "deliveryDetails" TEXT,
ADD COLUMN     "issuedAt" TIMESTAMP(3),
ADD COLUMN     "priceCoins" INTEGER,
ADD COLUMN     "rejectionReason" TEXT;

-- AlterTable
ALTER TABLE "ShopProduct" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "deliveryUrl" TEXT,
ADD COLUMN     "fulfillment" TEXT NOT NULL DEFAULT 'AUTOMATIC',
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'DIGITAL',
ADD COLUMN     "unlimitedStock" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "UserAchievement" ADD COLUMN     "progress" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "target" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "CoinAppeal" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "CoinAppealStatus" NOT NULL DEFAULT 'PENDING',
    "resolution" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoinAppeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoinRule" (
    "id" TEXT NOT NULL DEFAULT 'branch',
    "dailyAwardLimit" INTEGER NOT NULL DEFAULT 200,
    "weeklyAwardLimit" INTEGER NOT NULL DEFAULT 800,
    "teacherDailyLimit" INTEGER NOT NULL DEFAULT 50,
    "maxManualAward" INTEGER NOT NULL DEFAULT 100,
    "suspiciousAmount" INTEGER NOT NULL DEFAULT 100,
    "penaltyApprovalThreshold" INTEGER NOT NULL DEFAULT 50,
    "streakMinDailyActions" INTEGER NOT NULL DEFAULT 1,
    "streakBonusEvery" INTEGER NOT NULL DEFAULT 7,
    "streakBonusCoins" INTEGER NOT NULL DEFAULT 25,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoinRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCoinProfile" (
    "userId" TEXT NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "bonusXp" INTEGER NOT NULL DEFAULT 0,
    "streakCurrent" INTEGER NOT NULL DEFAULT 0,
    "streakBest" INTEGER NOT NULL DEFAULT 0,
    "lastActivityDate" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserCoinProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "CoinLevel" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "thresholdXp" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "perks" JSONB,

    CONSTRAINT "CoinLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoinQuest" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "period" "CoinQuestPeriod" NOT NULL DEFAULT 'DAILY',
    "targetType" TEXT NOT NULL,
    "targetValue" INTEGER NOT NULL,
    "rewardCoins" INTEGER NOT NULL DEFAULT 0,
    "rewardXp" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "seasonId" TEXT,

    CONSTRAINT "CoinQuest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserQuestProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),

    CONSTRAINT "UserQuestProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoinSeason" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "theme" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoinSeason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoinSeasonChallenge" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetValue" INTEGER NOT NULL,
    "rewardCoins" INTEGER NOT NULL DEFAULT 0,
    "rewardXp" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CoinSeasonChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoinSeasonParticipant" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoinSeasonParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopFavorite" (
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopFavorite_pkey" PRIMARY KEY ("userId","productId")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoinAppeal_transactionId_key" ON "CoinAppeal"("transactionId");

-- CreateIndex
CREATE INDEX "CoinAppeal_status_createdAt_idx" ON "CoinAppeal"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CoinLevel_code_key" ON "CoinLevel"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CoinQuest_code_key" ON "CoinQuest"("code");

-- CreateIndex
CREATE INDEX "UserQuestProgress_userId_periodKey_idx" ON "UserQuestProgress"("userId", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "UserQuestProgress_userId_questId_periodKey_key" ON "UserQuestProgress"("userId", "questId", "periodKey");

-- CreateIndex
CREATE INDEX "CoinSeasonParticipant_seasonId_points_idx" ON "CoinSeasonParticipant"("seasonId", "points");

-- CreateIndex
CREATE UNIQUE INDEX "CoinSeasonParticipant_seasonId_userId_key" ON "CoinSeasonParticipant"("seasonId", "userId");

-- CreateIndex
CREATE INDEX "ShopFavorite_userId_createdAt_idx" ON "ShopFavorite"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CoinTransaction_status_createdAt_idx" ON "CoinTransaction"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ShopOrder_status_createdAt_idx" ON "ShopOrder"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "CoinAppeal" ADD CONSTRAINT "CoinAppeal_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "CoinTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCoinProfile" ADD CONSTRAINT "UserCoinProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserQuestProgress" ADD CONSTRAINT "UserQuestProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserQuestProgress" ADD CONSTRAINT "UserQuestProgress_questId_fkey" FOREIGN KEY ("questId") REFERENCES "CoinQuest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinSeasonChallenge" ADD CONSTRAINT "CoinSeasonChallenge_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "CoinSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinSeasonParticipant" ADD CONSTRAINT "CoinSeasonParticipant_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "CoinSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinSeasonParticipant" ADD CONSTRAINT "CoinSeasonParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopFavorite" ADD CONSTRAINT "ShopFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopFavorite" ADD CONSTRAINT "ShopFavorite_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ShopProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

