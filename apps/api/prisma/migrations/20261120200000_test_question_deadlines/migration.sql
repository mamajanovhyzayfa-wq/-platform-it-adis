-- Индивидуальные дедлайны вопросов попытки: сохраняются между переходами.
ALTER TABLE "TestAttempt" ADD COLUMN "questionDeadlines" JSONB;
