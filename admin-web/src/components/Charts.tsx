/**
 * Небольшие графики без внешних библиотек.
 *
 * Панель администратора показывает агрегаты, которые уже посчитал сервер, поэтому
 * достаточно лёгких SVG/CSS-визуализаций: меньше зависимостей и предсказуемая сборка.
 */

export interface ChartDatum {
  label: string
  value: number
  tone?: 'primary' | 'success' | 'warning' | 'danger' | 'muted'
}

const tones: Record<NonNullable<ChartDatum['tone']>, string> = {
  primary: 'var(--primary)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  muted: 'var(--muted)',
}

/** Горизонтальные столбцы: удобно читать подписи и сравнивать значения. */
export function BarChart({ data, unit }: { data: ChartDatum[]; unit?: string }) {
  const max = Math.max(...data.map((item) => item.value), 1)

  return (
    <div className="bars" role="img" aria-label="Столбчатая диаграмма">
      {data.map((item) => (
        <div className="bar-row" key={item.label}>
          <span className="bar-label">{item.label}</span>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{ width: `${Math.round((item.value / max) * 100)}%`, background: tones[item.tone ?? 'primary'] }}
            />
          </div>
          <span className="bar-value">
            {item.value}
            {unit ? ` ${unit}` : ''}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Кольцевая диаграмма для долей: статусы записей, источники монет и т.п. */
export function DonutChart({ data, centerLabel }: { data: ChartDatum[]; centerLabel?: string }) {
  const total = data.reduce((sum, item) => sum + Math.max(item.value, 0), 0)
  const radius = 46
  const stroke = 16
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return (
    <div className="donut">
      <svg viewBox="0 0 120 120" width="132" height="132" role="img" aria-label="Кольцевая диаграмма">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        {total > 0
          ? data.map((item) => {
              const value = Math.max(item.value, 0)
              if (value === 0) return null
              const length = (value / total) * circumference
              const dash = `${length} ${circumference - length}`
              const circle = (
                <circle
                  key={item.label}
                  cx="60"
                  cy="60"
                  r={radius}
                  fill="none"
                  stroke={tones[item.tone ?? 'primary']}
                  strokeWidth={stroke}
                  strokeDasharray={dash}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 60 60)"
                  strokeLinecap="butt"
                />
              )
              offset += length
              return circle
            })
          : null}
        <text x="60" y="56" textAnchor="middle" className="donut-value">
          {total}
        </text>
        {centerLabel ? (
          <text x="60" y="72" textAnchor="middle" className="donut-label">
            {centerLabel}
          </text>
        ) : null}
      </svg>
      <ul className="legend">
        {data.map((item) => (
          <li key={item.label}>
            <span className="legend-dot" style={{ background: tones[item.tone ?? 'primary'] }} />
            <span className="legend-label">{item.label}</span>
            <strong>{item.value}</strong>
          </li>
        ))}
      </ul>
    </div>
  )
}
