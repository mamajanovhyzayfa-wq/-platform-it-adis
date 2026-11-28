interface EventRankingParticipant {
  userId: string
  user: { firstName: string; lastName: string }
}

interface EventRankingResult {
  userId: string
  score: number | null
  place: number | null
  taskId?: string | null
  user: { firstName: string; lastName: string }
}

interface EventRankingRow {
  userId: string
  name: string
  score: number
  place: number | null
}

/**
 * Рейтинг конкретного мероприятия: только его зарегистрированные участники.
 * Баллы по заданиям складываются, поэтому общий итог не зависит от количества заданий.
 * Участники без результатов остаются в таблице с нулём, а не исчезают из рейтинга.
 */
export function rankEventParticipants(
  participants: EventRankingParticipant[],
  results: EventRankingResult[],
): EventRankingRow[] {
  const totals = new Map<string, { row: EventRankingRow; overallScore: number | null; taskScore: number }>()

  for (const participant of participants) {
    totals.set(participant.userId, {
      row: {
        userId: participant.userId,
        name: `${participant.user.firstName} ${participant.user.lastName}`.trim(),
        score: 0,
        place: null,
      },
      overallScore: null,
      taskScore: 0,
    })
  }

  for (const result of results) {
    const item = totals.get(result.userId)
    // Результаты не зарегистрированных в мероприятии людей не попадают в рейтинг.
    if (!item) continue

    if (result.taskId == null) {
      // Общий итог не суммируется с заданиями, иначе баллы удвоятся.
      if (result.score !== null) item.overallScore = Math.max(item.overallScore ?? 0, result.score)
      if (result.place && (item.row.place === null || result.place < item.row.place)) {
        item.row.place = result.place
      }
    } else {
      item.taskScore += result.score ?? 0
    }
  }

  const ranking = [...totals.values()].map((item) => ({
    ...item.row,
    // Если внесён общий итог, он главнее суммы заданий; иначе складываем задания.
    score: item.overallScore !== null ? item.overallScore : item.taskScore,
  }))

  return ranking.sort(
    (a, b) => (a.place ?? Number.MAX_SAFE_INTEGER) - (b.place ?? Number.MAX_SAFE_INTEGER) || b.score - a.score,
  )
}
