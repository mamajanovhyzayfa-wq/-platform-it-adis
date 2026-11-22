-- Разрешение на скачивание управляется отдельно для каждого материала урока.
ALTER TABLE "LessonMaterial" ADD COLUMN "allowDownload" BOOLEAN NOT NULL DEFAULT true;
