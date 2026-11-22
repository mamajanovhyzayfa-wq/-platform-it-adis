-- AlterTable
ALTER TABLE "AiRequest" ADD COLUMN     "assumptions" JSONB,
ADD COLUMN     "confidence" INTEGER,
ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "error" TEXT,
ADD COLUMN     "feature" TEXT NOT NULL DEFAULT 'chat',
ADD COLUMN     "feedback" TEXT,
ADD COLUMN     "isFlagged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "role" "RoleName",
ADD COLUMN     "sources" JSONB,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'SUCCESS';

-- CreateTable
CREATE TABLE "AiSetting" (
    "id" TEXT NOT NULL DEFAULT 'branch',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "provider" TEXT NOT NULL DEFAULT 'openai',
    "model" TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    "dailyDefault" INTEGER NOT NULL DEFAULT 30,
    "maxTokens" INTEGER NOT NULL DEFAULT 900,
    "allowExternalSources" BOOLEAN NOT NULL DEFAULT false,
    "roleLimits" JSONB,
    "featurePermissions" JSONB,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRoleLimit" (
    "id" TEXT NOT NULL,
    "role" "RoleName" NOT NULL,
    "dailyRequests" INTEGER NOT NULL DEFAULT 20,
    "monthlyTokens" INTEGER NOT NULL DEFAULT 100000,
    "allowedFeatures" JSONB,
    "model" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiRoleLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUserLimit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dailyRequests" INTEGER,
    "monthlyTokens" INTEGER,
    "allowedFeatures" JSONB,
    "model" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUserLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiErrorReport" (
    "id" TEXT NOT NULL,
    "requestId" TEXT,
    "userId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiErrorReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAutomation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "triggerType" TEXT NOT NULL DEFAULT 'MANUAL',
    "triggerConfig" JSONB,
    "conditions" JSONB,
    "actions" JSONB,
    "schedule" TEXT,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),

    CONSTRAINT "AiAutomation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAutomationRun" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "input" JSONB,
    "result" JSONB,
    "error" TEXT,
    "approvedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AiAutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiRoleLimit_role_key" ON "AiRoleLimit"("role");

-- CreateIndex
CREATE UNIQUE INDEX "AiUserLimit_userId_key" ON "AiUserLimit"("userId");

-- CreateIndex
CREATE INDEX "AiErrorReport_status_createdAt_idx" ON "AiErrorReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AiAutomation_enabled_createdAt_idx" ON "AiAutomation"("enabled", "createdAt");

-- CreateIndex
CREATE INDEX "AiAutomationRun_automationId_startedAt_idx" ON "AiAutomationRun"("automationId", "startedAt");

-- CreateIndex
CREATE INDEX "AiAutomationRun_status_startedAt_idx" ON "AiAutomationRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "AiRequest_feature_createdAt_idx" ON "AiRequest"("feature", "createdAt");

-- CreateIndex
CREATE INDEX "AiRequest_status_createdAt_idx" ON "AiRequest"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "AiUserLimit" ADD CONSTRAINT "AiUserLimit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAutomationRun" ADD CONSTRAINT "AiAutomationRun_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "AiAutomation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

