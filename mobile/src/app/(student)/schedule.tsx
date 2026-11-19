import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, ErrorState, Screen, Skeleton, Title } from '@/components/ui'
import { ScheduleCalendar, addDays, addMonths, calendarRange, type CalendarMode } from '@/components/schedule'
import { api } from '@/api/api'
import { describeApiError } from '@/api/client'
import { spacing } from '@/theme'

function initialMode(): CalendarMode {
  return 'week'
}

/**
 * Расписание ученика: календарь на день, неделю и месяц.
 * Диапазон запроса совпадает с видимым периодом, поэтому сервер не отдаёт лишнего.
 */
export default function StudentSchedule() {
  const [mode, setMode] = useState<CalendarMode>(initialMode)
  const [anchor, setAnchor] = useState<Date>(() => new Date())
  const [selected, setSelected] = useState<Date>(() => new Date())

  const range = useMemo(() => calendarRange(mode, anchor), [mode, anchor])

  const { data, isLoading, isError, error, isRefetching, refetch } = useQuery({
    queryKey: ['schedule', range.from.toISOString(), range.to.toISOString()],
    queryFn: () => api.schedule({ from: range.from.toISOString(), to: range.to.toISOString() }),
  })

  const shift = (direction: -1 | 1) => {
    if (mode === 'day') {
      const next = addDays(selected, direction)
      setAnchor(next)
      setSelected(next)
      return
    }
    if (mode === 'week') {
      const next = addDays(anchor, direction * 7)
      setAnchor(next)
      setSelected(next)
      return
    }
    setAnchor(addMonths(anchor, direction))
    setSelected(addMonths(anchor, direction))
  }

  const changeMode = (next: CalendarMode) => {
    setMode(next)
    setAnchor(selected)
  }

  return (
    <Screen refreshing={isRefetching} onRefresh={() => void refetch()}>
      <Title subtitle="Занятия ваших курсов и подключение к видеовстречам.">Расписание</Title>

      {isLoading ? (
        <>
          <Skeleton height={48} borderRadius={24} />
          <Skeleton height={72} borderRadius={16} />
          <Card>
            <Skeleton width="55%" height={18} />
            <Skeleton width="35%" height={12} style={{ marginTop: spacing.sm }} />
            <Skeleton height={44} borderRadius={12} style={{ marginTop: spacing.md }} />
          </Card>
        </>
      ) : isError ? (
        <ErrorState
          title="Не удалось загрузить расписание"
          message={describeApiError(error)}
          onRetry={() => void refetch()}
        />
      ) : (
        <ScheduleCalendar
          items={data ?? []}
          mode={mode}
          anchor={anchor}
          selected={selected}
          onChangeMode={changeMode}
          onShift={shift}
          onToday={() => {
            const today = new Date()
            setAnchor(today)
            setSelected(today)
          }}
          onSelect={(date) => {
            setSelected(date)
            if (mode === 'day') setAnchor(date)
          }}
        />
      )}
    </Screen>
  )
}
