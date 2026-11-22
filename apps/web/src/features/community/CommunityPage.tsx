import { useState } from 'react'
import { getSession } from '../../api/client'
import { AnnouncementsPanel } from './AnnouncementsPanel'
import { ChatsPanel } from './ChatsPanel'
import { EventsPanel } from './EventsPanel'
import { MeetingsPanel } from './MeetingsPanel'
import { tabLabels, type Tab } from './shared'

export function CommunityPage() {
  const [tab, setTab] = useState<Tab>('chats')
  const session = getSession()
  const staff = session?.role === 'ADMIN' || session?.role === 'MANAGER'

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <h1>Сообщество</h1>
          <p className="muted">Личные и групповые чаты, встречи с наставником, объявления и мероприятия платформы.</p>
        </div>
      </header>

      <div className="segmented" role="tablist" aria-label="Разделы сообщества">
        {(Object.keys(tabLabels) as Tab[]).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            className={tab === item ? 'segmented-item segmented-active' : 'segmented-item'}
            onClick={() => setTab(item)}
          >
            {tabLabels[item]}
          </button>
        ))}
      </div>

      {tab === 'chats' ? <ChatsPanel /> : null}
      {tab === 'meetings' ? <MeetingsPanel /> : null}
      {tab === 'announcements' ? <AnnouncementsPanel staff={staff} /> : null}
      {tab === 'events' ? <EventsPanel staff={staff} /> : null}
    </div>
  )
}
