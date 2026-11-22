import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common'
import { z } from 'zod'
import { CurrentUser, Roles, type AuthUser } from '../../nest/common/decorators.js'
import { zodBody } from '../../nest/common/zod.pipe.js'
import {
  aiGenerateSchema,
  attemptFocusSchema,
  attemptReviewSchema,
  attemptSubmitSchema,
  bankCreateSchema,
  bankImportSchema,
  bankQuestionSchema,
  questionSchema,
  testCreateSchema,
  testUpdateSchema,
} from '../assessment/assessment.schemas.js'
import { TestingService } from './testing.service.js'

const publishSchema = z.object({ published: z.boolean() })
const progressSchema = z.object({
  answers: attemptSubmitSchema.shape.answers,
})

@Controller('api/assessment')
export class TestsController {
  constructor(@Inject(TestingService) private readonly testing: TestingService) {}

  // ---------- тесты ----------

  @Get('tests')
  tests(@CurrentUser() user: AuthUser) {
    return this.testing.list(user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Post('tests')
  createTest(@CurrentUser() user: AuthUser, @Body(zodBody(testCreateSchema)) body: z.infer<typeof testCreateSchema>) {
    return this.testing.create(body, user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Post('tests/ai-generate')
  aiGenerate(@CurrentUser() user: AuthUser, @Body(zodBody(aiGenerateSchema)) body: z.infer<typeof aiGenerateSchema>) {
    return this.testing.generate(body, user.userId, user.role)
  }

  @Get('tests/:id')
  testDetail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.testing.detail(id, user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Patch('tests/:id')
  updateTest(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(testUpdateSchema)) body: z.infer<typeof testUpdateSchema>,
  ) {
    return this.testing.update(id, body, user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Post('tests/:id/publish')
  publishTest(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(zodBody(publishSchema)) body: { published: boolean }) {
    return this.testing.publish(id, user.userId, user.role, body.published)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @HttpCode(204)
  @Delete('tests/:id')
  async removeTest(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.testing.remove(id, user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Get('tests/:id/results')
  testResults(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.testing.results(id, user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Post('tests/:id/questions')
  addQuestion(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(questionSchema)) body: z.infer<typeof questionSchema>,
  ) {
    return this.testing.addQuestion(id, body, user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Patch('questions/:id')
  updateQuestion(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(questionSchema)) body: z.infer<typeof questionSchema>,
  ) {
    return this.testing.updateQuestion(id, body, user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @HttpCode(204)
  @Delete('questions/:id')
  async removeQuestion(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.testing.removeQuestion(id, user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Post('tests/:id/import')
  importQuestions(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(zodBody(bankImportSchema)) body: { questionIds: string[] }) {
    return this.testing.importQuestions(id, body.questionIds, user.userId, user.role)
  }

  @Roles('STUDENT')
  @Post('tests/:id/start')
  startTest(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.testing.start(id, user.userId)
  }

  // ---------- прохождение ----------

  @Roles('STUDENT')
  @Post('attempts/:id/focus')
  focus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(attemptFocusSchema)) body: { questionId: string },
  ) {
    return this.testing.focus(id, user.userId, body.questionId)
  }

  @Roles('STUDENT')
  @Post('attempts/:id/progress')
  progress(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(progressSchema)) body: { answers: Array<{ questionId: string; value: unknown }> },
  ) {
    return this.testing.saveProgress(id, user.userId, body.answers)
  }

  @Roles('STUDENT')
  @Post('attempts/:id/submit')
  submitAttempt(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(attemptSubmitSchema)) body: { answers: Array<{ questionId: string; value: unknown }> },
  ) {
    return this.testing.submit(id, user.userId, body.answers)
  }

  @Get('attempts/:id/result')
  result(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.testing.result(id, user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Post('attempts/:id/review')
  reviewAttempt(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(attemptReviewSchema)) body: z.infer<typeof attemptReviewSchema>,
  ) {
    return this.testing.review(id, user.userId, user.role, body)
  }

  // ---------- банк вопросов ----------

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Get('banks')
  banks(@CurrentUser() user: AuthUser) {
    return this.testing.banks(user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Post('banks')
  createBank(@CurrentUser() user: AuthUser, @Body(zodBody(bankCreateSchema)) body: { title: string; description?: string }) {
    return this.testing.createBank(body, user.userId)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Get('banks/:id')
  bankDetail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.testing.bankDetail(id, user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @Post('banks/:id/questions')
  addBankQuestion(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(bankQuestionSchema)) body: z.infer<typeof bankQuestionSchema>,
  ) {
    return this.testing.addBankQuestion(id, body, user.userId, user.role)
  }

  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  @HttpCode(204)
  @Delete('bank-questions/:id')
  async removeBankQuestion(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.testing.removeBankQuestion(id, user.userId, user.role)
  }

}
