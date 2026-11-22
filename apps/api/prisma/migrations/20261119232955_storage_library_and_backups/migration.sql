-- CreateEnum
CREATE TYPE "FileCategory" AS ENUM ('DOCUMENT', 'IMAGE', 'AUDIO', 'VIDEO', 'PDF', 'PRESENTATION', 'ARCHIVE', 'OTHER');

-- CreateEnum
CREATE TYPE "FileStorageAccess" AS ENUM ('PRIVATE', 'STAFF', 'BRANCH');

-- CreateEnum
CREATE TYPE "BackupKind" AS ENUM ('DATABASE', 'FILES');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "RestoreStatus" AS ENUM ('DETECTED', 'CHECKED', 'PLANNED', 'AWAITING_APPROVAL', 'APPROVED', 'RUNNING', 'VERIFIED', 'FAILED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FileAuditAction" ADD VALUE 'UPDATE';
ALTER TYPE "FileAuditAction" ADD VALUE 'DELETE';

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "backupEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "backupFrequencyHours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "backupIncludeFiles" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "backupRetentionDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "fileMaxSizeMb" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "fileQuotaMb" INTEGER NOT NULL DEFAULT 10240,
ADD COLUMN     "lastBackupAt" TIMESTAMP(3),
ADD COLUMN     "lastBackupStatus" TEXT;

-- AlterTable
ALTER TABLE "FileAuditLog" ADD COLUMN     "fileId" TEXT;

-- CreateTable
CREATE TABLE "StorageFile" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "category" "FileCategory" NOT NULL DEFAULT 'OTHER',
    "title" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "scanStatus" TEXT NOT NULL DEFAULT 'CLEAN',
    "access" "FileStorageAccess" NOT NULL DEFAULT 'BRANCH',
    "description" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "StorageFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupRun" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "kind" "BackupKind" NOT NULL,
    "status" "BackupStatus" NOT NULL DEFAULT 'RUNNING',
    "storageKey" TEXT,
    "sizeBytes" BIGINT,
    "sha256" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "error" TEXT,
    "metadata" JSONB,

    CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestoreRequest" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "backupId" TEXT NOT NULL,
    "status" "RestoreStatus" NOT NULL DEFAULT 'DETECTED',
    "reason" TEXT,
    "requestedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "confirmationPhrase" TEXT,
    "plan" JSONB,
    "report" JSONB,
    "error" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedAt" TIMESTAMP(3),
    "plannedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "RestoreRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StorageFile_storageKey_key" ON "StorageFile"("storageKey");

-- CreateIndex
CREATE INDEX "StorageFile_ownerId_createdAt_idx" ON "StorageFile"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "StorageFile_category_createdAt_idx" ON "StorageFile"("category", "createdAt");

-- CreateIndex
CREATE INDEX "StorageFile_access_createdAt_idx" ON "StorageFile"("access", "createdAt");

-- CreateIndex
CREATE INDEX "StorageFile_deletedAt_createdAt_idx" ON "StorageFile"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "StorageFile_sha256_idx" ON "StorageFile"("sha256");

-- CreateIndex
CREATE INDEX "BackupRun_branchId_kind_startedAt_idx" ON "BackupRun"("branchId", "kind", "startedAt");

-- CreateIndex
CREATE INDEX "BackupRun_status_startedAt_idx" ON "BackupRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "RestoreRequest_branchId_status_detectedAt_idx" ON "RestoreRequest"("branchId", "status", "detectedAt");

-- CreateIndex
CREATE INDEX "FileAuditLog_fileId_createdAt_idx" ON "FileAuditLog"("fileId", "createdAt");

-- AddForeignKey
ALTER TABLE "FileAuditLog" ADD CONSTRAINT "FileAuditLog_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "StorageFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageFile" ADD CONSTRAINT "StorageFile_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackupRun" ADD CONSTRAINT "BackupRun_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestoreRequest" ADD CONSTRAINT "RestoreRequest_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestoreRequest" ADD CONSTRAINT "RestoreRequest_backupId_fkey" FOREIGN KEY ("backupId") REFERENCES "BackupRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
