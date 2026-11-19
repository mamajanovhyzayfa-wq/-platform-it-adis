import { Router } from 'express'
import { z } from 'zod'
import { badRequest, notFound, tooManyRequests } from '../../lib/errors.js'
import { env } from '../../config/env.js'
import { requireAuth } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { writeAudit } from '../../lib/audit.js'

/**
 * AI-помощник по коду.
 *
 * Ключ модели живёт только на сервере. Помощник работает в режиме наставника:
 * задаёт вопросы, объясняет концепции и указывает, где искать ошибку, но не выдаёт
 * готовое решение целиком — это требование продукта к учебному процессу.
 *
 * Запросы ограничены по количеству на пользователя в сутки, чтобы расход ключа
 * не уходил в бесконечный цикл из клиента.
 */

const SYSTEM_PROMPT = [
  'Ты — AI-помощник образовательной платформы ITadis для учеников, изучающих программирование.',
  'Правила ответа:',
  '1. Отвечай по-русски, кратко и структурно.',
  '2. Никогда не выдавай готовый код целиком, который можно скопировать как решение задания.',
  '   Разрешены небольшие фрагменты (1–5 строк) как иллюстрация одной идеи или синтаксиса.',
  '3. Сначала задай 1–2 уточняющих вопроса, если задача сформулирована расплывчато.',
  '4. Объясняй причину ошибки и следующий шаг, но оставляй реализацию ученику.',
  '5. Если просят полностью решить задачу или тест — вежливо откажи и предложи план из шагов.',
  '6. Если вопрос не про код и обучение — коротко скажи, что помогаешь только с учёбой.',
].join('\n')

const chatSchema = z
  .object({
    messages: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string().trim().min(1).max(4000),
        }),
      )
      .min(1)
      .max(20),
    topic: z.string().trim().max(200).optional(),
  })
  .strict()

type ChatInput = z.infer<typeof chatSchema>

const DAILY_LIMIT = env.AI_DAILY_REQUEST_LIMIT
const usage = new Map<string, { day: string; count: number }>()

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function consumeQuota(userId: string): { used: number; limit: number } {
  const key = `${userId}:${today()}`
  const current = usage.get(key) ?? { day: today(), count: 0 }
  if (current.count >= DAILY_LIMIT) {
    throw tooManyRequests(`Достигнут дневной лимит запросов к AI-помощнику: ${DAILY_LIMIT}`)
  }
  current.count += 1
  usage.set(key, current)
  return { used: current.count, limit: DAILY_LIMIT }
}

export const aiRouter = Router()

aiRouter.get('/status', requireAuth, (req, res) => {
  const quota = usage.get(`${req.auth!.userId}:${today()}`)
  res.json({
    configured: Boolean(env.OPENAI_API_KEY),
    model: env.OPENAI_MODEL,
    used: quota?.count ?? 0,
    limit: DAILY_LIMIT,
  })
})

aiRouter.post('/chat', requireAuth, validate(chatSchema), async (req, res) => {
  if (!env.OPENAI_API_KEY) {
    res.status(503).json({
      error: {
        code: 'AI_NOT_CONFIGURED',
        message: 'AI-помощник не настроен: добавьте OPENAI_API_KEY в .env на сервере',
      },
    })
    return
  }

  const { messages, topic } = req.body as ChatInput
  if (messages[messages.length - 1]?.role !== 'user') {
    throw badRequest('Последнее сообщение должно быть от пользователя')
  }

  const quota = consumeQuota(req.auth!.userId)

  const payloadMessages = [
    { role: 'system' as const, content: topic ? `${SYSTEM_PROMPT}\n\nУченик сейчас изучает: ${topic}` : SYSTEM_PROMPT },
    ...messages,
  ]

  let upstream: Response
  try {
    upstream = await fetch(`${env.OPENAI_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        messages: payloadMessages,
        temperature: 0.4,
        max_tokens: 700,
      }),
      signal: AbortSignal.timeout(30_000),
    })
  } catch (error) {
    console.warn('[ai] запрос к модели не удался', error instanceof Error ? error.message : error)
    res.status(502).json({
      error: { code: 'AI_UNAVAILABLE', message: 'AI-помощник временно недоступен, попробуйте позже' },
    })
    return
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '')
    console.warn(`[ai] модель ответила ${upstream.status}: ${text.slice(0, 300)}`)
    if (upstream.status === 401 || upstream.status === 403) {
      res.status(502).json({
        error: { code: 'AI_AUTH', message: 'Ключ AI-помощника отклонён провайдером. Проверьте OPENAI_API_KEY.' },
      })
      return
    }
    if (upstream.status === 429) {
      res.status(429).json({
        error: { code: 'AI_RATE_LIMIT', message: 'Слишком много запросов к модели, попробуйте через минуту' },
      })
      return
    }
    res.status(502).json({ error: { code: 'AI_ERROR', message: 'AI-помощник вернул ошибку' } })
    return
  }

  const data = (await upstream.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: { total_tokens?: number }
  }

  const reply = data.choices?.[0]?.message?.content?.trim()
  if (!reply) {
    notFound('Модель не вернула ответ')
  }

  await writeAudit({
    actorId: req.auth!.userId,
    action: 'ai.chat',
    entity: 'ai_assistant',
    metadata: { tokens: data.usage?.total_tokens ?? null, messages: messages.length },
    ip: req.ip,
  })

  res.json({
    reply,
    usage: { used: quota.used, limit: quota.limit },
    model: env.OPENAI_MODEL,
  })
})
