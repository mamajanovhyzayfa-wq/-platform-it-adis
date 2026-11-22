import { useState } from 'react'
import { ExpensesTab } from './ExpensesTab'
import { InvoicesTab } from './InvoicesTab'
import { OverviewTab } from './OverviewTab'
import { PaymentsTab } from './PaymentsTab'
import { PricingTab } from './PricingTab'
import { ProvidersTab } from './ProvidersTab'
import { RefundsTab } from './RefundsTab'
import { TeachersTab } from './TeachersTab'
import { tabs, type Tab } from './format'

export function FinancePage() {
  const [tab, setTab] = useState<Tab>('overview')

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <h1>Финансы</h1>
          <p className="muted">Счета, платежи, возвраты, расходы и тарифы филиала.</p>
        </div>
      </header>

      <div className="tabs">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? 'tab tab-active' : 'tab'}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'overview' ? <OverviewTab /> : null}
      {tab === 'invoices' ? <InvoicesTab /> : null}
      {tab === 'payments' ? <PaymentsTab /> : null}
      {tab === 'refunds' ? <RefundsTab /> : null}
      {tab === 'expenses' ? <ExpensesTab /> : null}
      {tab === 'pricing' ? <PricingTab /> : null}
      {tab === 'teachers' ? <TeachersTab /> : null}
      {tab === 'providers' ? <ProvidersTab /> : null}
    </div>
  )
}
