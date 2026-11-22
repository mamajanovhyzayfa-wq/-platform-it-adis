-- AI помогает преподавателю, но не выставляет итоговую оценку.
-- Результат сохраняется у версии работы, чтобы его можно было открыть повторно.
ALTER TABLE "HomeworkSubmission" ADD COLUMN "aiFeedback" JSONB;
ALTER TABLE "HomeworkSubmission" ADD COLUMN "aiReviewedAt" TIMESTAMP(3);
