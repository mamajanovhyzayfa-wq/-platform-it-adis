import { useState } from 'react'
import { getSession } from '../../api/client'
import { PageHeader } from '../../components/ui'
import { CalendarTab } from './CalendarTab'
import { ApprovalsTab, ClassroomsTab, SettingsTab, StatsTab, TemplatesTab } from './ReferenceTabs'
import type { Tab } from './shared'

/** Управление расписанием: календарь, серии, аудитории, согласования и статистика. */
export function SchedulePage() {
  const role = getSession()?.role
  const isManager = role === 'ADMIN' || role === 'MANAGER'
  const [tab, setTab] = useState<Tab>('calendar')

  return (
    <div className="stack">
      <PageHeader
        title="Расписание"
        subtitle="Занятия, повторяющиеся серии, аудитории, конфликты, замены и контроль нагрузки."
      />
      <div className="tabs" role="tablist">
        {[
          ['calendar', 'Календарь'],
          ['templates', 'Шаблоны и серии'],
          ['classrooms', 'Аудитории'],
          ['approvals', 'Согласования'],
          ['stats', 'Нагрузка и статистика'],
          ['settings', 'Запись и часы'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? 'tab tab-active' : 'tab'}
            onClick={() => setTab(value as Tab)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'calendar' ? <CalendarTab isManager={isManager} /> : null}
      {tab === 'templates' ? <TemplatesTab /> : null}
      {tab === 'classrooms' ? <ClassroomsTab isManager={isManager} /> : null}
      {tab === 'approvals' ? <ApprovalsTab /> : null}
      {tab === 'stats' ? <StatsTab /> : null}
      {tab === 'settings' ? <SettingsTab isManager={isManager} /> : null}
    </div>
  )
}
