import { env } from '../../config/env.js'
import { AppError } from '../../lib/errors.js'

/**
 * Вызов модели с ответом в JSON. Ключ живёт только на сервере.
 * AI здесь — помощник преподавателя: итоговую оценку всегда подтверждает человек.
 */
/** Убирает ключ из диагностического текста провайдера перед записью в лог. */
function safeProviderText(value: string): string {
  const secret = env.OPENAI_API_KEY
  return (secret ? value.split(secret).join('[redacted]') : value).slice(0, 300)
}

export async function aiJson<T>(system: string, user: string, maxTokens = 1400): Promise<T> {
  if (!env.OPENAI_API_KEY) {
    throw new AppError(
      503,
      'AI_NOT_CONFIGURED',
      'AI не настроен: добавьте OPENAI_API_KEY в переменные окружения сервера',
    )
  }

  let response: Response
  try {
    response = await fetch(`${env.OPENAI_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.2,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(45_000),
    })
  } catch (error) {
    console.warn(
      '[assessment-ai] провайдер недоступен',
      safeProviderText(error instanceof Error ? error.message : String(error)),
    )
    throw new AppError(502, 'AI_UNAVAILABLE', 'AI временно недоступен, попробуйте позже')
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    console.warn(`[assessment-ai] ${response.status}: ${safeProviderText(text)}`)
    if (response.status === 401 || response.status === 403) {
      throw new AppError(502, 'AI_AUTH', 'Ключ AI отклонён провайдером. Проверьте OPENAI_API_KEY.')
    }
    if (response.status === 429) {
      throw new AppError(429, 'AI_RATE_LIMIT', 'Слишком много запросов к AI, попробуйте позже')
    }
    throw new AppError(502, 'AI_ERROR', 'AI вернул ошибку')
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const content = data.choices?.[0]?.message?.content?.trim()
  if (!content) throw new AppError(502, 'AI_EMPTY', 'AI не вернул ответ')

  const cleaned = content.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    return JSON.parse(cleaned) as T
  } catch {
    throw new AppError(502, 'AI_INVALID', 'AI вернул ответ в неожиданном формате, попробуйте ещё раз')
  }
}
