-- Настройки записи: null на уровне группы означает «как в филиале».
-- Ранее колонки были NOT NULL DEFAULT false, поэтому филиал не мог включить
-- запись для курса, который её не переопределял.
ALTER TABLE "Course" ALTER COLUMN "recordingEnabled" DROP NOT NULL;
ALTER TABLE "Course" ALTER COLUMN "recordingEnabled" DROP DEFAULT;
ALTER TABLE "Course" ALTER COLUMN "recordingAuto" DROP NOT NULL;
ALTER TABLE "Course" ALTER COLUMN "recordingAuto" DROP DEFAULT;

-- Значение false было значением по умолчанию, а не явным выбором группы.
UPDATE "Course" SET "recordingEnabled" = NULL WHERE "recordingEnabled" = false;
UPDATE "Course" SET "recordingAuto" = NULL WHERE "recordingAuto" = false;
