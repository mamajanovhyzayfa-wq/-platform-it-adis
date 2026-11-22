-- AlterTable
ALTER TABLE "RegistrationRequest" ADD COLUMN     "consentAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "consentVersions" JSONB,
ADD COLUMN     "marketingOptIn" BOOLEAN NOT NULL DEFAULT false;
