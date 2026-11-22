-- Финансовый кабинет: скидки, корректировки, платёжные аккаунты,
-- ставки наставников и настройки уведомлений о пропусках.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ATTENDANCE_ABSENCE';

ALTER TABLE "Teacher" ADD COLUMN "lessonRateKgs" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "BranchSettings"
  ADD COLUMN "notifyAbsenceStudent" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notifyAbsenceParent" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notifyAbsenceTeacher" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notifyAbsenceManager" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Expense" ADD COLUMN "documentUrls" JSONB;

ALTER TABLE "CoursePriceHistory" ADD COLUMN "reason" TEXT;

CREATE TABLE "InvoiceDiscount" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoiceDiscount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentAdjustment" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "previousAmount" INTEGER NOT NULL,
  "newAmount" INTEGER NOT NULL,
  "previousStatus" "PaymentStatus" NOT NULL,
  "newStatus" "PaymentStatus" NOT NULL,
  "reason" TEXT NOT NULL,
  "adjustedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentProviderAccount" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "tenantId" TEXT,
  "secretEnvVar" TEXT NOT NULL,
  "webhookSecretEnvVar" TEXT,
  "baseUrl" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "settings" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentProviderAccount_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InvoiceDiscount_invoiceId_createdAt_idx" ON "InvoiceDiscount"("invoiceId", "createdAt");
CREATE INDEX "PaymentAdjustment_paymentId_createdAt_idx" ON "PaymentAdjustment"("paymentId", "createdAt");
CREATE UNIQUE INDEX "PaymentProviderAccount_provider_merchantId_key" ON "PaymentProviderAccount"("provider", "merchantId");
CREATE INDEX "PaymentProviderAccount_enabled_isDefault_idx" ON "PaymentProviderAccount"("enabled", "isDefault");

ALTER TABLE "InvoiceDiscount"
  ADD CONSTRAINT "InvoiceDiscount_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InvoiceDiscount"
  ADD CONSTRAINT "InvoiceDiscount_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentAdjustment"
  ADD CONSTRAINT "PaymentAdjustment_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentAdjustment"
  ADD CONSTRAINT "PaymentAdjustment_adjustedById_fkey"
  FOREIGN KEY ("adjustedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
