-- Вложения: владелец файла, чтобы /uploads не отдавал чужие файлы любому
-- авторизованному пользователю (аудит S-1).
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Attachment_name_key" ON "Attachment"("name");
CREATE INDEX "Attachment_ownerId_idx" ON "Attachment"("ownerId");

ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Гонка регистрации (аудит D-1): две одновременные заявки с одним email
-- проходили проверку и создавали две записи PENDING. Перед созданием индекса
-- более ранние дубликаты переводятся в REJECTED — записи не удаляются.
UPDATE "RegistrationRequest" AS older
SET "status" = 'REJECTED',
    "rejectReason" = COALESCE(older."rejectReason", 'Дубликат заявки: оставлена более поздняя'),
    "decidedAt" = COALESCE(older."decidedAt", CURRENT_TIMESTAMP)
FROM "RegistrationRequest" AS newer
WHERE older."status" = 'PENDING'
  AND newer."status" = 'PENDING'
  AND lower(older."email") = lower(newer."email")
  AND (
    older."createdAt" < newer."createdAt"
    OR (older."createdAt" = newer."createdAt" AND older."id" < newer."id")
  );

CREATE UNIQUE INDEX "RegistrationRequest_pending_email_key"
    ON "RegistrationRequest" (lower("email"))
    WHERE "status" = 'PENDING';
