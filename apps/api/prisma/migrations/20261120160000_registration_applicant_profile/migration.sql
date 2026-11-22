-- Данные несовершеннолетнего заявителя переносятся в профиль при одобрении.
ALTER TABLE "RegistrationRequest"
  ADD COLUMN "birthDate" TIMESTAMP(3),
  ADD COLUMN "guardianName" TEXT,
  ADD COLUMN "guardianPhone" TEXT,
  ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'ru';
