-- Настройки внешних интеграций и журнал обращений к провайдерам.
-- Секреты в этих таблицах не хранятся: только имена переменных окружения.

CREATE TABLE "IntegrationConfig" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "settings" JSONB,
  "secretEnvVars" JSONB,
  "lastCheckedAt" TIMESTAMP(3),
  "lastStatus" TEXT,
  "lastMessage" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntegrationConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntegrationConfig_provider_key" ON "IntegrationConfig"("provider");

CREATE TYPE "IntegrationEventStatus" AS ENUM ('OK', 'FAILED', 'SKIPPED');

CREATE TABLE "IntegrationEvent" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "status" "IntegrationEventStatus" NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "durationMs" INTEGER,
  "message" TEXT,
  "metadata" JSONB,
  "actorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IntegrationEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IntegrationEvent_provider_createdAt_idx" ON "IntegrationEvent"("provider", "createdAt");
CREATE INDEX "IntegrationEvent_status_createdAt_idx" ON "IntegrationEvent"("status", "createdAt");
CREATE INDEX "IntegrationEvent_action_createdAt_idx" ON "IntegrationEvent"("action", "createdAt");
