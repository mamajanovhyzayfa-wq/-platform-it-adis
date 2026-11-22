import { z } from 'zod'

/** Ссылка должна вести на http(s) или на локальный файл, а не на javascript: и подобные схемы. */
const safeUrl = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label}: укажите ссылку`)
    .max(2048)
    .refine((value) => /^(https?:\/\/|\/)/i.test(value), `${label}: нужна http(s)-ссылка или путь от корня`)

const optionalBlockUrl = z
  .string()
  .trim()
  .max(2048)
  .optional()
  .refine((value) => value == null || value === '' || /^(https?:\/\/|\/)/i.test(value), 'Блок: нужна http(s)-ссылка или путь от корня')

const optionalCoverUrl = z
  .string()
  .trim()
  .max(2048)
  .nullable()
  .optional()
  .refine((value) => value == null || value === '' || /^(https?:\/\/|\/)/i.test(value), 'Обложка: нужна http(s)-ссылка или путь от корня')

/** Блок визуального конструктора урока. */
export const blockSchema = z.object({
  id: z.string().trim().min(1).max(64),
  type: z.enum([
    'text',
    'image',
    'video',
    'audio',
    'document',
    'file',
    'pdf',
    'presentation',
    'link',
    'assignment',
    'test',
    'interactive',
  ]),
  title: z.string().trim().max(300).optional(),
  text: z.string().max(20000).optional(),
  url: optionalBlockUrl,
  caption: z.string().trim().max(1000).optional(),
  description: z.string().trim().max(4000).optional(),
  dueAt: z.string().trim().max(40).optional(),
  testId: z.string().uuid().optional(),
  homeworkId: z.string().uuid().optional(),
  prompt: z.string().trim().max(2000).optional(),
  options: z.array(z.string().trim().max(300)).max(8).optional(),
  correctOption: z.number().int().min(0).max(7).optional(),
  /// Для файловых блоков: можно ли ученику скачать файл, а не только открыть.
  allowDownload: z.boolean().optional(),
})

export const blocksSchema = z.array(blockSchema).max(200)

export const courseCreateSchema = z.object({
  title: z.string().trim().min(3, 'Название минимум 3 символа').max(200),
  description: z.string().trim().min(10, 'Описание минимум 10 символов').max(4000),
  coverUrl: optionalCoverUrl,
  level: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).default('BEGINNER'),
  teacherId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
})

export const courseUpdateSchema = courseCreateSchema.partial()

export const reviewSchema = z.object({
  approve: z.boolean(),
  reason: z.string().trim().max(500).optional(),
})

export const lessonBlocksSchema = z.object({
  blocks: blocksSchema,
  autosave: z.boolean().default(false),
  note: z.string().trim().max(200).optional(),
  title: z.string().trim().min(1, 'Название урока не может быть пустым').max(200).optional(),
  durationMinutes: z.number().int().min(0).max(600).optional(),
})

export const moduleSchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional(),
})

export const lessonCreateSchema = z.object({
  moduleId: z.string().uuid(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2000).optional(),
  durationMinutes: z.number().int().min(0).max(600).default(0),
  blocks: blocksSchema.optional(),
})

export const materialCreateSchema = z.object({
  type: z.enum(['VIDEO', 'AUDIO', 'DOCUMENT', 'PRESENTATION', 'PDF', 'FILE', 'IMAGE', 'LINK']),
  title: z.string().trim().min(1).max(255),
  url: safeUrl('Материал'),
  mimeType: z.string().trim().max(160).optional(),
  sizeBytes: z.number().int().min(0).max(200_000_000).optional(),
  allowDownload: z.boolean().default(true),
})

export const noteSchema = z.object({
  body: z.string().trim().max(10000),
})

export const highlightSchema = z.object({
  quote: z.string().trim().min(2, 'Выделите фрагмент').max(1200),
  note: z.string().trim().max(1000).optional(),
  color: z.enum(['yellow', 'green', 'blue', 'pink']).default('yellow'),
})

export const copyLessonSchema = z.object({
  targetModuleId: z.string().uuid().optional(),
})

export type BlockInput = z.infer<typeof blockSchema>
