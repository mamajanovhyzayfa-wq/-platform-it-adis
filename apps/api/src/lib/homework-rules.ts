import type { SubmissionStatus } from '@prisma/client'

export type HomeworkPolicy = {
  dueAt: Date
  maxAttempts: number
  allowLate: boolean
  allowResubmit: boolean
}

export type SubmissionSummary = {
  attempt: number
  status: SubmissionStatus
}

export type SubmissionAvailability = {
  attemptsUsed: number
  attemptsLeft: number
  latestStatus: SubmissionStatus | null
  late: boolean
  canSubmit: boolean
  reason: string | null
}

/**
 * Единое правило для всех клиентов:
 * - лимит версий действует всегда;
 * - пока работа на проверке, новую версию отправить нельзя;
 * - после возврата преподаватель ждёт исправление, даже если срок прошёл;
 * - после принятия новая версия возможна только при allowResubmit.
 */
export function homeworkSubmissionAvailability(
  homework: HomeworkPolicy,
  submissions: SubmissionSummary[],
  now = new Date(),
): SubmissionAvailability {
  const attemptsUsed = submissions.length
  const attemptsLeft = Math.max(homework.maxAttempts - attemptsUsed, 0)
  const latest = submissions.reduce<SubmissionSummary | null>(
    (current, item) => (!current || item.attempt > current.attempt ? item : current),
    null,
  )
  const late = now.getTime() > homework.dueAt.getTime()

  let reason: string | null = null
  if (attemptsLeft === 0) {
    reason = `Использованы все версии отправки (${homework.maxAttempts})`
  } else if (latest?.status === 'SUBMITTED') {
    reason = 'Работа уже отправлена и ждёт проверки преподавателя'
  } else if (latest?.status === 'REVIEWED' && !homework.allowResubmit) {
    reason = 'Работа уже принята. Повторная сдача для этого задания не разрешена'
  } else if (latest?.status !== 'RETURNED' && late && !homework.allowLate) {
    reason = 'Срок сдачи задания истёк'
  }

  return {
    attemptsUsed,
    attemptsLeft,
    latestStatus: latest?.status ?? null,
    late,
    canSubmit: reason === null,
    reason,
  }
}
