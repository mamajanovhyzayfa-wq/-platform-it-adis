-- CreateEnum
CREATE TYPE "BranchStatus" AS ENUM ('PROVISIONING', 'PROVISIONED', 'ACTIVE', 'FAILED');

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "databaseName" TEXT NOT NULL,
    "storagePrefix" TEXT NOT NULL,
    "status" "BranchStatus" NOT NULL DEFAULT 'PROVISIONING',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "adminEmail" TEXT NOT NULL,
    "adminName" TEXT,
    "config" JSONB,
    "steps" JSONB,
    "lastError" TEXT,
    "provisionedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Branch_slug_key" ON "Branch"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_domain_key" ON "Branch"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_databaseName_key" ON "Branch"("databaseName");

-- CreateIndex
CREATE INDEX "Branch_status_idx" ON "Branch"("status");

-- Основной филиал использует уже существующую БД (DATABASE_URL) и работает как fallback
-- для домена, который ещё не привязан к отдельному филиалу.
INSERT INTO "Branch" (
    "id", "name", "slug", "domain", "databaseName", "storagePrefix", "status",
    "isPrimary", "adminEmail", "adminName", "config", "provisionedAt", "activatedAt", "updatedAt"
) VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Основной филиал',
    'primary',
    'primary.local',
    'primary',
    'primary',
    'ACTIVE',
    true,
    'admin@itadis.kg',
    'Администратор',
    '{"locale":"ru","currency":"KGS","timezone":"Asia/Bishkek","allowPublicSignup":true}'::jsonb,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);
