import { describe, expect, it } from 'vitest'
import { rankEventParticipants } from '../src/modules/community/event-ranking.js'

const participant = (userId: string, firstName: string, lastName: string) => ({
  userId,
  user: { firstName, lastName },
})

const result = (
  userId: string,
  firstName: string,
  score: number | null,
  place: number | null = null,
  taskId: string | null = null,
) => ({
  userId,
  score,
  place,
  taskId,
  user: { firstName, lastName: 'Участников' },
})

describe('рейтинг мероприятия', () => {
  it('включает зарегистрированных участников без результатов', () => {
    const ranking = rankEventParticipants(
      [participant('a', 'Адис', 'Исаков'), participant('b', 'Айгуль', 'Осмонова')],
      [result('a', 'Адис', 40)],
    )

    expect(ranking).toHaveLength(2)
    expect(ranking.find((row) => row.userId === 'b')).toMatchObject({ score: 0, place: null })
  })

  it('складывает баллы за задания и сохраняет общее призовое место', () => {
    const ranking = rankEventParticipants(
      [participant('a', 'Адис', 'Исаков')],
      [result('a', 'Адис', 40, null, 'task-1'), result('a', 'Адис', 35, null, 'task-2'), result('a', 'Адис', null, 2)],
    )

    expect(ranking[0]).toMatchObject({ userId: 'a', score: 75, place: 2 })
  })

  it('использует общий итог вместо повторного сложения заданий', () => {
    const ranking = rankEventParticipants(
      [participant('a', 'Адис', 'Исаков')],
      [result('a', 'Адис', 75), result('a', 'Адис', 40, null, 'task-1')],
    )

    expect(ranking[0]?.score).toBe(75)
  })

  it('сортирует по месту, затем по баллам', () => {
    const ranking = rankEventParticipants(
      [participant('a', 'Адис', 'Исаков'), participant('b', 'Айгуль', 'Осмонова'), participant('c', 'Бек', 'Асанов')],
      [result('a', 'Адис', 60), result('b', 'Айгуль', 90), result('c', 'Бек', 80, 1)],
    )

    expect(ranking.map((row) => row.userId)).toEqual(['c', 'b', 'a'])
  })

  it('не добавляет в рейтинг результаты людей вне мероприятия', () => {
    const ranking = rankEventParticipants(
      [participant('a', 'Адис', 'Исаков')],
      [result('a', 'Адис', 10), result('outsider', 'Посторонний', 999, 1)],
    )

    expect(ranking).toHaveLength(1)
    expect(ranking[0]?.userId).toBe('a')
  })
})
