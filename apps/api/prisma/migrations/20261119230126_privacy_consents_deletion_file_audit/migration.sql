-- CreateEnum
CREATE TYPE "AccountDeletionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FileAuditAction" AS ENUM ('UPLOAD', 'DOWNLOAD');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ConsentType" ADD VALUE 'COOKIES';
ALTER TYPE "ConsentType" ADD VALUE 'COOKIE_ANALYTICS';
ALTER TYPE "ConsentType" ADD VALUE 'COOKIE_FUNCTIONAL';
ALTER TYPE "ConsentType" ADD VALUE 'COOKIE_MARKETING';
ALTER TYPE "ConsentType" ADD VALUE 'GUARDIAN';

-- AlterTable
ALTER TABLE "Conversation" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "AccountDeletionRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AccountDeletionStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "adminComment" TEXT,
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,

    CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountDeletionEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "status" "AccountDeletionStatus" NOT NULL,
    "comment" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountDeletionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileAuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" "FileAuditAction" NOT NULL,
    "fileName" TEXT NOT NULL,
    "url" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "sha256" TEXT,
    "scanStatus" TEXT NOT NULL DEFAULT 'CLEAN',
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountDeletionRequest_status_requestedAt_idx" ON "AccountDeletionRequest"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "AccountDeletionRequest_userId_requestedAt_idx" ON "AccountDeletionRequest"("userId", "requestedAt");

-- CreateIndex
CREATE INDEX "AccountDeletionEvent_requestId_createdAt_idx" ON "AccountDeletionEvent"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "FileAuditLog_userId_createdAt_idx" ON "FileAuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "FileAuditLog_action_createdAt_idx" ON "FileAuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "FileAuditLog_sha256_idx" ON "FileAuditLog"("sha256");

-- AddForeignKey
ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountDeletionEvent" ADD CONSTRAINT "AccountDeletionEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "AccountDeletionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountDeletionEvent" ADD CONSTRAINT "AccountDeletionEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAuditLog" ADD CONSTRAINT "FileAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
