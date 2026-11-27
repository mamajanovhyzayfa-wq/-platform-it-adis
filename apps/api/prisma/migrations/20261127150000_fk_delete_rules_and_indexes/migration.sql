-- D-2: часть внешних ключей на User блокировала удаление аккаунта.
--   CASCADE  — связки замен (TeacherSubstitution): без участников запись не нужна.
--   SET NULL — авторство/подпись (сертификат, расход, скидка, возврат, запись, серия):
--              сама запись должна переживать удаление сотрудника.
--   Course.teacherId, Homework.teacherId и Invoice.studentId оставлены RESTRICT:
--              курс/задание не могут остаться без преподавателя, счёт — документ учёта.
--              Рабочий сценарий удаления аккаунта — обезличивание (privacy.routes.ts).
-- D-3: индексы на 79 FK-колонок без ведущего индекса (Seq Scan при каскадных удалениях).

-- DropForeignKey
ALTER TABLE "Certificate" DROP CONSTRAINT "Certificate_issuedById_fkey";

-- DropForeignKey
ALTER TABLE "CoursePriceHistory" DROP CONSTRAINT "CoursePriceHistory_changedById_fkey";

-- DropForeignKey
ALTER TABLE "Exam" DROP CONSTRAINT "Exam_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Expense" DROP CONSTRAINT "Expense_createdById_fkey";

-- DropForeignKey
ALTER TABLE "HomeworkReview" DROP CONSTRAINT "HomeworkReview_reviewerId_fkey";

-- DropForeignKey
ALTER TABLE "InvoiceDiscount" DROP CONSTRAINT "InvoiceDiscount_createdById_fkey";

-- DropForeignKey
ALTER TABLE "PaymentAdjustment" DROP CONSTRAINT "PaymentAdjustment_adjustedById_fkey";

-- DropForeignKey
ALTER TABLE "Refund" DROP CONSTRAINT "Refund_requestedById_fkey";

-- DropForeignKey
ALTER TABLE "ScheduleSeries" DROP CONSTRAINT "ScheduleSeries_teacherId_fkey";

-- DropForeignKey
ALTER TABLE "TeacherSubstitution" DROP CONSTRAINT "TeacherSubstitution_assignedById_fkey";

-- DropForeignKey
ALTER TABLE "TeacherSubstitution" DROP CONSTRAINT "TeacherSubstitution_fromTeacherId_fkey";

-- DropForeignKey
ALTER TABLE "TeacherSubstitution" DROP CONSTRAINT "TeacherSubstitution_toTeacherId_fkey";

-- DropForeignKey
ALTER TABLE "VideoRoom" DROP CONSTRAINT "VideoRoom_createdById_fkey";

-- AlterTable
ALTER TABLE "Certificate" ALTER COLUMN "issuedById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "CoursePriceHistory" ALTER COLUMN "changedById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Exam" ALTER COLUMN "createdById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Expense" ALTER COLUMN "createdById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "HomeworkReview" ALTER COLUMN "reviewerId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "InvoiceDiscount" ALTER COLUMN "createdById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PaymentAdjustment" ALTER COLUMN "adjustedById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Refund" ALTER COLUMN "requestedById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ScheduleSeries" ALTER COLUMN "teacherId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "VideoRoom" ALTER COLUMN "createdById" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "AccountDeletionEvent_actorId_idx" ON "AccountDeletionEvent"("actorId");

-- CreateIndex
CREATE INDEX "AccountDeletionRequest_reviewedById_idx" ON "AccountDeletionRequest"("reviewedById");

-- CreateIndex
CREATE INDEX "Announcement_createdById_idx" ON "Announcement"("createdById");

-- CreateIndex
CREATE INDEX "Attendance_markedById_idx" ON "Attendance"("markedById");

-- CreateIndex
CREATE INDEX "AttendanceSession_userId_idx" ON "AttendanceSession"("userId");

-- CreateIndex
CREATE INDEX "CalendarTask_courseId_idx" ON "CalendarTask"("courseId");

-- CreateIndex
CREATE INDEX "CoinSeasonChallenge_seasonId_idx" ON "CoinSeasonChallenge"("seasonId");

-- CreateIndex
CREATE INDEX "CoinSeasonParticipant_userId_idx" ON "CoinSeasonParticipant"("userId");

-- CreateIndex
CREATE INDEX "CoinTransaction_awardedById_idx" ON "CoinTransaction"("awardedById");

-- CreateIndex
CREATE INDEX "CoinTransaction_reversedById_idx" ON "CoinTransaction"("reversedById");

-- CreateIndex
CREATE INDEX "CommunityEvent_createdById_idx" ON "CommunityEvent"("createdById");

-- CreateIndex
CREATE INDEX "Conversation_createdById_idx" ON "Conversation"("createdById");

-- CreateIndex
CREATE INDEX "Course_authorId_idx" ON "Course"("authorId");

-- CreateIndex
CREATE INDEX "CoursePriceHistory_changedById_idx" ON "CoursePriceHistory"("changedById");

-- CreateIndex
CREATE INDEX "EventAward_createdById_idx" ON "EventAward"("createdById");

-- CreateIndex
CREATE INDEX "EventAward_userId_idx" ON "EventAward"("userId");

-- CreateIndex
CREATE INDEX "EventRegistration_userId_idx" ON "EventRegistration"("userId");

-- CreateIndex
CREATE INDEX "EventResult_createdById_idx" ON "EventResult"("createdById");

-- CreateIndex
CREATE INDEX "EventResult_taskId_idx" ON "EventResult"("taskId");

-- CreateIndex
CREATE INDEX "EventResult_userId_idx" ON "EventResult"("userId");

-- CreateIndex
CREATE INDEX "Exam_createdById_idx" ON "Exam"("createdById");

-- CreateIndex
CREATE INDEX "Exam_gradingScaleId_idx" ON "Exam"("gradingScaleId");

-- CreateIndex
CREATE INDEX "Exam_testId_idx" ON "Exam"("testId");

-- CreateIndex
CREATE INDEX "Expense_createdById_idx" ON "Expense"("createdById");

-- CreateIndex
CREATE INDEX "ExtraSessionEnrollment_userId_idx" ON "ExtraSessionEnrollment"("userId");

-- CreateIndex
CREATE INDEX "Feedback_teacherId_idx" ON "Feedback"("teacherId");

-- CreateIndex
CREATE INDEX "Homework_gradingScaleId_idx" ON "Homework"("gradingScaleId");

-- CreateIndex
CREATE INDEX "Homework_lessonId_idx" ON "Homework"("lessonId");

-- CreateIndex
CREATE INDEX "Homework_teacherId_idx" ON "Homework"("teacherId");

-- CreateIndex
CREATE INDEX "HomeworkReview_reviewerId_idx" ON "HomeworkReview"("reviewerId");

-- CreateIndex
CREATE INDEX "Invoice_issuedById_idx" ON "Invoice"("issuedById");

-- CreateIndex
CREATE INDEX "InvoiceDiscount_createdById_idx" ON "InvoiceDiscount"("createdById");

-- CreateIndex
CREATE INDEX "KnowledgeMaterial_authorId_idx" ON "KnowledgeMaterial"("authorId");

-- CreateIndex
CREATE INDEX "LessonComment_userId_idx" ON "LessonComment"("userId");

-- CreateIndex
CREATE INDEX "LessonMaterial_lessonId_idx" ON "LessonMaterial"("lessonId");

-- CreateIndex
CREATE INDEX "LessonNote_lessonId_idx" ON "LessonNote"("lessonId");

-- CreateIndex
CREATE INDEX "LessonQuestion_answeredById_idx" ON "LessonQuestion"("answeredById");

-- CreateIndex
CREATE INDEX "MaterialBookmark_materialId_idx" ON "MaterialBookmark"("materialId");

-- CreateIndex
CREATE INDEX "MeetingRequest_courseId_idx" ON "MeetingRequest"("courseId");

-- CreateIndex
CREATE INDEX "MeetingRequest_studentId_idx" ON "MeetingRequest"("studentId");

-- CreateIndex
CREATE INDEX "Message_senderId_idx" ON "Message"("senderId");

-- CreateIndex
CREATE INDEX "Payment_confirmedById_idx" ON "Payment"("confirmedById");

-- CreateIndex
CREATE INDEX "Payment_registeredById_idx" ON "Payment"("registeredById");

-- CreateIndex
CREATE INDEX "PaymentAdjustment_adjustedById_idx" ON "PaymentAdjustment"("adjustedById");

-- CreateIndex
CREATE INDEX "Refund_requestedById_idx" ON "Refund"("requestedById");

-- CreateIndex
CREATE INDEX "Refund_reviewedById_idx" ON "Refund"("reviewedById");

-- CreateIndex
CREATE INDEX "RegistrationRequest_decidedById_idx" ON "RegistrationRequest"("decidedById");

-- CreateIndex
CREATE INDEX "RestoreRequest_backupId_idx" ON "RestoreRequest"("backupId");

-- CreateIndex
CREATE INDEX "Schedule_cancelledById_idx" ON "Schedule"("cancelledById");

-- CreateIndex
CREATE INDEX "Schedule_createdById_idx" ON "Schedule"("createdById");

-- CreateIndex
CREATE INDEX "Schedule_templateId_idx" ON "Schedule"("templateId");

-- CreateIndex
CREATE INDEX "ScheduleChange_decidedById_idx" ON "ScheduleChange"("decidedById");

-- CreateIndex
CREATE INDEX "ScheduleChange_proposedClassroomId_idx" ON "ScheduleChange"("proposedClassroomId");

-- CreateIndex
CREATE INDEX "ScheduleChange_proposedTeacherId_idx" ON "ScheduleChange"("proposedTeacherId");

-- CreateIndex
CREATE INDEX "ScheduleChange_requestedById_idx" ON "ScheduleChange"("requestedById");

-- CreateIndex
CREATE INDEX "ScheduleEvent_actorId_idx" ON "ScheduleEvent"("actorId");

-- CreateIndex
CREATE INDEX "ScheduleMessage_userId_idx" ON "ScheduleMessage"("userId");

-- CreateIndex
CREATE INDEX "ScheduleSeries_classroomId_idx" ON "ScheduleSeries"("classroomId");

-- CreateIndex
CREATE INDEX "ScheduleSeries_courseId_idx" ON "ScheduleSeries"("courseId");

-- CreateIndex
CREATE INDEX "ScheduleSeries_createdById_idx" ON "ScheduleSeries"("createdById");

-- CreateIndex
CREATE INDEX "ScheduleSeries_teacherId_idx" ON "ScheduleSeries"("teacherId");

-- CreateIndex
CREATE INDEX "ScheduleSeries_templateId_idx" ON "ScheduleSeries"("templateId");

-- CreateIndex
CREATE INDEX "ScheduleTemplate_classroomId_idx" ON "ScheduleTemplate"("classroomId");

-- CreateIndex
CREATE INDEX "ScheduleTemplate_courseId_idx" ON "ScheduleTemplate"("courseId");

-- CreateIndex
CREATE INDEX "ScheduleTemplate_createdById_idx" ON "ScheduleTemplate"("createdById");

-- CreateIndex
CREATE INDEX "ScheduleTemplate_teacherId_idx" ON "ScheduleTemplate"("teacherId");

-- CreateIndex
CREATE INDEX "ShopFavorite_productId_idx" ON "ShopFavorite"("productId");

-- CreateIndex
CREATE INDEX "ShopOrder_productId_idx" ON "ShopOrder"("productId");

-- CreateIndex
CREATE INDEX "TeacherSubstitution_assignedById_idx" ON "TeacherSubstitution"("assignedById");

-- CreateIndex
CREATE INDEX "TeacherSubstitution_fromTeacherId_idx" ON "TeacherSubstitution"("fromTeacherId");

-- CreateIndex
CREATE INDEX "TeacherSubstitution_toTeacherId_idx" ON "TeacherSubstitution"("toTeacherId");

-- CreateIndex
CREATE INDEX "Test_gradingScaleId_idx" ON "Test"("gradingScaleId");

-- CreateIndex
CREATE INDEX "Test_lessonId_idx" ON "Test"("lessonId");

-- CreateIndex
CREATE INDEX "TestAnswer_questionId_idx" ON "TestAnswer"("questionId");

-- CreateIndex
CREATE INDEX "TestAnswer_reviewedById_idx" ON "TestAnswer"("reviewedById");

-- CreateIndex
CREATE INDEX "TestAttempt_gradedById_idx" ON "TestAttempt"("gradedById");

-- CreateIndex
CREATE INDEX "UserAchievement_achievementId_idx" ON "UserAchievement"("achievementId");

-- CreateIndex
CREATE INDEX "UserQuestProgress_questId_idx" ON "UserQuestProgress"("questId");

-- CreateIndex
CREATE INDEX "VideoRoom_createdById_idx" ON "VideoRoom"("createdById");

-- AddForeignKey
ALTER TABLE "HomeworkReview" ADD CONSTRAINT "HomeworkReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleSeries" ADD CONSTRAINT "ScheduleSeries_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherSubstitution" ADD CONSTRAINT "TeacherSubstitution_fromTeacherId_fkey" FOREIGN KEY ("fromTeacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherSubstitution" ADD CONSTRAINT "TeacherSubstitution_toTeacherId_fkey" FOREIGN KEY ("toTeacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherSubstitution" ADD CONSTRAINT "TeacherSubstitution_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoRoom" ADD CONSTRAINT "VideoRoom_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoursePriceHistory" ADD CONSTRAINT "CoursePriceHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceDiscount" ADD CONSTRAINT "InvoiceDiscount_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAdjustment" ADD CONSTRAINT "PaymentAdjustment_adjustedById_fkey" FOREIGN KEY ("adjustedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

