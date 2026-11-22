-- Список диалогов выбирает участия по userId; без индекса это seq scan.
CREATE INDEX "ConversationParticipant_userId_idx" ON "ConversationParticipant"("userId");
