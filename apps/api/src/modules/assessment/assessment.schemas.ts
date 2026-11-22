import { z } from 'zod'

const fileUrl = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((value) => /^(https?:\/\/|\/)/i.test(value), 'Нужна http(s)-ссылка или путь от корня')

const attachmentSchema = z.object({
  name: z.string().trim().min(1).max(255),
  url: fileUrl,
  type: z.string().trim().max(120).optional(),
  size: z.number().int().min(0).max(200_000_000).optional(),
})

const criteriaSchema = z.object({
  title: z.string().trim().min(1).max(160),
  weight: z.number().int().min(0).max(100),
  description: z.string().trim().max(500).optional(),
})

export const homeworkCreateSchema = z.object({
  courseId: z.string().uuid(),
  lessonId: z.string().uuid().optional(),
  title: z.string().trim().min(3, 'Название минимум 3 символа').max(200),
  description: z.string().trim().min(3, 'Добавьте описание задания').max(10000),
  dueAt: z.coerce.date(),
  maxScore: z.number().int().min(1).max(1000).default(10),
  materials: z.array(attachmentSchema).max(30).optional(),
  criteria: z.array(criteriaSchema).max(30).optional(),
  maxAttempts: z.number().int().min(1).max(10).default(1),
  allowLate: z.boolean().default(false),
  latePenalty: z.number().int().min(0).max(100).default(0),
  allowResubmit: z.boolean().default(false),
  assignAll: z.boolean().default(true),
  studentIds: z.array(z.string().uuid()).max(300).optional(),
  gradingScaleId: z.string().uuid().optional(),
})

export const homeworkUpdateSchema = homeworkCreateSchema.omit({ courseId: true }).partial()

export const homeworkSubmitSchema = z
  .object({
    text: z.string().trim().max(20000).optional(),
    projectUrl: fileUrl.optional(),
    files: z.array(attachmentSchema).max(20).optional(),
    comment: z.string().trim().max(2000).optional(),
    idempotencyKey: z.string().trim().min(8).max(120).optional(),
  })
  .refine((data) => Boolean(data.text?.trim() || data.projectUrl || (data.files && data.files.length > 0)), {
    message: 'Добавьте текст решения, ссылку или файлы',
    path: ['text'],
  })

export const homeworkReviewSchema = z.object({
  score: z.number().int().min(0).max(1000),
  comment: z.string().trim().max(5000).optional(),
  criteriaScores: z.array(z.object({ title: z.string().trim().min(1).max(160), score: z.number().min(0).max(1000) })).max(30).optional(),
  returnForRevision: z.boolean().default(false),
}).refine((data) => !data.returnForRevision || Boolean(data.comment?.trim()), {
  message: 'Опишите, что нужно исправить',
  path: ['comment'],
})

export const aiReviewSchema = z.object({
  instructions: z.string().trim().max(1000).optional(),
})

const optionSchema = z.object({
  text: z.string().trim().min(1).max(500),
  isCorrect: z.boolean().default(false),
})

const matchPairSchema = z.object({
  left: z.string().trim().min(1).max(300),
  right: z.string().trim().min(1).max(300),
})

export const questionSchema = z.object({
  type: z.enum(['SINGLE', 'MULTIPLE', 'TEXT', 'MATCHING', 'NUMBER', 'BOOLEAN']),
  prompt: z.string().trim().min(3, 'Вопрос минимум 3 символа').max(5000),
  points: z.number().int().min(1).max(100).default(1),
  explanation: z.string().trim().max(2000).optional(),
  topic: z.string().trim().max(120).optional(),
  timeLimitSeconds: z.number().int().min(5).max(3600).optional(),
  options: z.array(optionSchema).max(10).optional(),
  matchPairs: z.array(matchPairSchema).max(20).optional(),
  correctNumber: z.number().optional(),
  correctBoolean: z.boolean().optional(),
  correctText: z.string().trim().max(1000).optional(),
})

export const testCreateSchema = z.object({
  courseId: z.string().uuid(),
  lessonId: z.string().uuid().optional(),
  title: z.string().trim().min(3, 'Название минимум 3 символа').max(200),
  description: z.string().trim().max(4000).optional(),
  timeLimitMinutes: z.number().int().min(1).max(600).default(30),
  questionTimeLimitSeconds: z.number().int().min(5).max(3600).nullable().optional(),
  passingScore: z.number().int().min(0).max(100).default(60),
  attemptsAllowed: z.number().int().min(1).max(20).default(3),
  shuffleQuestions: z.boolean().default(false),
  shuffleOptions: z.boolean().default(false),
  showExplanations: z.boolean().default(true),
  showCorrectAnswers: z.boolean().default(true),
  gradingScaleId: z.string().uuid().nullable().optional(),
})

export const testUpdateSchema = testCreateSchema.omit({ courseId: true }).partial()

export const attemptAnswerSchema = z.object({
  questionId: z.string().uuid(),
  value: z.unknown(),
})

export const attemptSubmitSchema = z.object({
  answers: z.array(attemptAnswerSchema).max(300).default([]),
})

export const attemptFocusSchema = z.object({
  questionId: z.string().uuid(),
})

export const attemptReviewSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().uuid(),
        pointsAwarded: z.number().int().min(0).max(100),
        comment: z.string().trim().max(2000).optional(),
      }),
    )
    .max(300),
  comment: z.string().trim().max(2000).optional(),
})

export const aiGenerateSchema = z
  .object({
    topic: z.string().trim().min(3).max(300).optional(),
    material: z.string().trim().max(20000).optional(),
    difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).default('MEDIUM'),
    count: z.number().int().min(1).max(30).default(5),
    types: z
      .array(z.enum(['SINGLE', 'MULTIPLE', 'TEXT', 'MATCHING']))
      .min(1)
      .max(4)
      .default(['SINGLE']),
    testId: z.string().uuid().optional(),
  })
  .refine((data) => Boolean(data.topic?.trim() || data.material?.trim()), {
    message: 'Укажите тему или учебный материал',
    path: ['topic'],
  })

export const bankCreateSchema = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).optional(),
})

export const bankQuestionSchema = questionSchema

export const bankImportSchema = z.object({
  questionIds: z.array(z.string().uuid()).min(1).max(100),
})

export const examCreateSchema = z.object({
  testId: z.string().uuid(),
  courseId: z.string().uuid().optional(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(4000).optional(),
  instructions: z.string().trim().max(10000).optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  durationMinutes: z.number().int().min(1).max(600).default(60),
  maxAttempts: z.number().int().min(1).max(10).default(1),
  passingScore: z.number().int().min(0).max(100).default(60),
  allowLateRegistration: z.boolean().default(false),
  gradingScaleId: z.string().uuid().optional(),
})

export const examUpdateSchema = examCreateSchema.partial()

export const gradingScaleSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional(),
  isDefault: z.boolean().default(false),
  bands: z
    .array(
      z.object({
        minPercent: z.number().int().min(0).max(100),
        maxPercent: z.number().int().min(0).max(100),
        label: z.string().trim().min(1).max(60),
        description: z.string().trim().max(500).optional(),
      }),
    )
    .min(1, 'Добавьте хотя бы один диапазон')
    .max(20),
})

export type HomeworkCreateInput = z.infer<typeof homeworkCreateSchema>
export type QuestionInput = z.infer<typeof questionSchema>
export type TestCreateInput = z.infer<typeof testCreateSchema>
export type ExamCreateInput = z.infer<typeof examCreateSchema>
