import { describe, expect, it } from 'vitest'
import { attendanceMarkSchema, scheduleUpdateSchema } from '../src/modules/scheduling/scheduling.schemas.js'
import {
  BRANCH_OFFSET_MINUTES,
  addDays,
  combineLocal,
  localDateKey,
  localWeekday,
  manualAttendanceTiming,
  minutesOfDay,
  overlaps,
  seriesDates,
  startOfLocalDay,
} from '../src/modules/scheduling/scheduling.time.js'

describe('расписание: время филиала', () => {
  it('хранит UTC и трактует ввод как местное время UTC+6', () => {
    expect(BRANCH_OFFSET_MINUTES).toBe(360)
    expect(combineLocal('2026-11-20', '09:00').toISOString()).toBe('2026-11-20T03:00:00.000Z')
    expect(combineLocal('2026-11-20', '23:30').toISOString()).toBe('2026-11-20T17:30:00.000Z')
  })

  it('не теряет дату на границах суток', () => {
    expect(localDateKey(combineLocal('2026-11-20', '00:30'))).toBe('2026-11-20')
    expect(localDateKey(combineLocal('2026-11-20', '23:59'))).toBe('2026-11-20')
    expect(minutesOfDay(combineLocal('2026-11-20', '09:15'))).toBe(555)
  })

  it('считает день недели с понедельника', () => {
    expect(localWeekday(combineLocal('2026-11-16', '10:00'))).toBe(0)
    expect(localWeekday(combineLocal('2026-11-20', '10:00'))).toBe(4)
    expect(localWeekday(combineLocal('2026-11-22', '10:00'))).toBe(6)
  })

  it('начало локальных суток — это предыдущий вечер в UTC', () => {
    const start = startOfLocalDay(combineLocal('2026-11-20', '15:30'))
    expect(start.toISOString()).toBe('2026-11-19T18:00:00.000Z')
    expect(localDateKey(start)).toBe('2026-11-20')
  })

  it('прибавляет дни без влияния часового пояса', () => {
    const base = combineLocal('2026-11-20', '10:00')
    expect(localDateKey(addDays(base, 1))).toBe('2026-11-21')
    expect(localDateKey(addDays(base, -1))).toBe('2026-11-19')
  })
})

describe('расписание: конфликты занятий', () => {
  const at = (start: string, end: string) => ({
    start: combineLocal('2026-11-20', start),
    end: combineLocal('2026-11-20', end),
  })

  it('занятия встык не конфликтуют', () => {
    const first = at('09:00', '10:00')
    const second = at('10:00', '11:00')
    expect(overlaps(first.start, first.end, second.start, second.end)).toBe(false)
  })

  it('пересечение по времени обнаруживается', () => {
    const first = at('09:00', '10:00')
    const inside = at('09:30', '10:30')
    const before = at('08:30', '09:30')

    expect(overlaps(first.start, first.end, inside.start, inside.end)).toBe(true)
    expect(overlaps(first.start, first.end, before.start, before.end)).toBe(true)
  })

  it('вложенный интервал считается конфликтом', () => {
    const lesson = at('09:00', '11:00')
    const inner = at('09:30', '10:00')
    expect(overlaps(lesson.start, lesson.end, inner.start, inner.end)).toBe(true)
    expect(overlaps(inner.start, inner.end, lesson.start, lesson.end)).toBe(true)
  })

  it('одинаковые интервалы конфликтуют, а разные дни — нет', () => {
    const first = at('09:00', '10:00')
    expect(overlaps(first.start, first.end, first.start, first.end)).toBe(true)

    const tomorrow = {
      start: addDays(first.start, 1),
      end: addDays(first.end, 1),
    }
    expect(overlaps(first.start, first.end, tomorrow.start, tomorrow.end)).toBe(false)
  })

  it('не считает конфликтом нулевой или обратный интервал', () => {
    const lesson = at('09:00', '10:00')
    expect(overlaps(lesson.start, lesson.end, lesson.start, lesson.start)).toBe(false)
    expect(overlaps(lesson.start, lesson.end, lesson.end, lesson.start)).toBe(false)
  })
})

describe('расписание: серии занятий', () => {
  it('DAILY включает дату окончания', () => {
    expect(
      seriesDates({
        rule: 'DAILY',
        weekdays: [],
        interval: 1,
        startsOn: '2026-11-16',
        endsOn: '2026-11-20',
      }),
    ).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'])
  })

  it('DAILY не создаёт занятий, если окончание раньше начала', () => {
    expect(
      seriesDates({
        rule: 'DAILY',
        weekdays: [],
        interval: 1,
        startsOn: '2026-11-20',
        endsOn: '2026-11-19',
      }),
    ).toEqual([])
  })

  it('INTERVAL пропускает заданное число дней и не делится на ноль', () => {
    const dates = seriesDates({
      rule: 'INTERVAL',
      weekdays: [],
      interval: 3,
      startsOn: '2026-11-16',
      endsOn: '2026-11-25',
    })
    expect(dates).toEqual(['2026-11-16', '2026-11-19', '2026-11-22', '2026-11-25'])

    expect(
      seriesDates({
        rule: 'INTERVAL',
        weekdays: [],
        interval: 0,
        startsOn: '2026-11-16',
        endsOn: '2026-11-18',
      }),
    ).toEqual(['2026-11-16', '2026-11-17', '2026-11-18'])
  })

  it('WEEKLY повторяет день недели старта с шагом в неделях', () => {
    expect(
      seriesDates({
        rule: 'WEEKLY',
        weekdays: [],
        interval: 1,
        startsOn: '2026-11-16',
        endsOn: '2026-12-07',
      }),
    ).toEqual(['2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07'])

    expect(
      seriesDates({
        rule: 'WEEKLY',
        weekdays: [],
        interval: 2,
        startsOn: '2026-11-16',
        endsOn: '2026-12-14',
      }),
    ).toEqual(['2026-11-16', '2026-11-30', '2026-12-14'])
  })

  it('SELECTED_DAYS берёт только выбранные дни и убирает повторы', () => {
    expect(
      seriesDates({
        rule: 'SELECTED_DAYS',
        weekdays: [4, 0, 2, 0, 2],
        interval: 1,
        startsOn: '2026-11-16',
        endsOn: '2026-11-22',
      }),
    ).toEqual(['2026-11-16', '2026-11-18', '2026-11-20'])
  })

  it('ограничивает серию 180 занятиями', () => {
    const dates = seriesDates({
      rule: 'DAILY',
      weekdays: [],
      interval: 1,
      startsOn: '2026-01-01',
    })
    expect(dates).toHaveLength(180)
    expect(dates[0]).toBe('2026-01-01')
    expect(dates.at(-1)).toBe('2026-06-29')
  })
})

describe('расписание: ручная посещаемость', () => {
  const timing = (status: 'PRESENT' | 'LATE' | 'LEFT_EARLY' | 'ABSENT', lateMinutes?: number, earlyLeaveMinutes?: number) =>
    manualAttendanceTiming({
      startsAt: combineLocal('2026-11-20', '09:00'),
      endsAt: combineLocal('2026-11-20', '10:30'),
      status,
      lateMinutes,
      earlyLeaveMinutes,
    })

  it('учитывает опоздание и уменьшает время присутствия', () => {
    const result = timing('LATE', 20)
    expect(result.joinedAt.toISOString()).toBe(combineLocal('2026-11-20', '09:20').toISOString())
    expect(result.leftAt.toISOString()).toBe(combineLocal('2026-11-20', '10:30').toISOString())
    expect(result.durationSeconds).toBe(70 * 60)
    expect(result.lateMinutes).toBe(20)
  })

  it('учитывает ранний выход', () => {
    const result = timing('LEFT_EARLY', undefined, 15)
    expect(result.leftAt.toISOString()).toBe(combineLocal('2026-11-20', '10:15').toISOString())
    expect(result.durationSeconds).toBe(75 * 60)
    expect(result.earlyLeaveMinutes).toBe(15)
  })

  it('не допускает минуты больше длительности и обнуляет отсутствие', () => {
    const clamped = timing('LATE', 999)
    expect(clamped.lateMinutes).toBe(90)
    expect(clamped.durationSeconds).toBe(0)

    const absent = timing('ABSENT', 20, 15)
    expect(absent.durationSeconds).toBe(0)
    expect(absent.lateMinutes).toBe(0)
    expect(absent.earlyLeaveMinutes).toBe(0)
  })
})

describe('расписание: схемы ручных правок', () => {
  it('принимает минуты опоздания и раннего выхода', () => {
    const parsed = attendanceMarkSchema.parse({
      items: [{ userId: '00000000-0000-4000-8000-000000000001', status: 'LATE', lateMinutes: 15 }],
    })
    expect(parsed.items[0]?.lateMinutes).toBe(15)
  })

  it('отклоняет отрицательные минуты', () => {
    expect(() =>
      attendanceMarkSchema.parse({
        items: [{ userId: '00000000-0000-4000-8000-000000000001', status: 'LEFT_EARLY', earlyLeaveMinutes: -1 }],
      }),
    ).toThrow()
  })

  it('принимает причину замены при редактировании занятия', () => {
    const parsed = scheduleUpdateSchema.parse({ teacherId: '00000000-0000-4000-8000-000000000001', changeReason: 'Болезнь' })
    expect(parsed.changeReason).toBe('Болезнь')
  })
})
