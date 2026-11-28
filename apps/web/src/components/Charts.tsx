import { useId } from 'react'

/**
 * Небольшие графики без внешних библиотек.
 *
 * Панель администратора показывает агрегаты, которые уже посчитал сервер, поэтому
 * достаточно лёгких SVG/CSS-визуализаций: меньше зависимостей и предсказуемая сборка.
 */

interface ChartDatum {
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

/** Линейный график динамики: месяцы, результаты, посещаемость. */
export function LineChart({
  data,
  unit = '%',
  tone = 'primary',
}: {
  data: Array<{ label: string; value: number | null }>
  unit?: string
  tone?: NonNullable<ChartDatum['tone']>
}) {
  const gradientId = useId().replace(/:/g, '')
  const width = 620
  const height = 190
  const padding = { left: 34, right: 12, top: 14, bottom: 26 }
  const values = data.map((item) => item.value).filter((value): value is number => value !== null)
  const max = Math.max(...values, 100)
  const min = Math.min(...values, 0)
  const range = Math.max(max - min, 1)
  const point = (value: number, index: number) => {
    const x = padding.left + (index / Math.max(data.length - 1, 1)) * (width - padding.left - padding.right)
    const y = padding.top + (1 - (value - min) / range) * (height - padding.top - padding.bottom)
    return { x, y }
  }
  const points = data.map((item, index) => (item.value === null ? null : point(item.value, index)))
  const path = points
    .map((entry, index) => (entry ? `${index === 0 || !points[index - 1] ? 'M' : 'L'} ${entry.x} ${entry.y}` : ''))
    .join(' ')
  const firstPoint = points.find(Boolean)
  const lastPoint = [...points].reverse().find(Boolean)
  const areaPath =
    firstPoint && lastPoint
      ? `${path} L ${lastPoint.x} ${height - padding.bottom} L ${firstPoint.x} ${height - padding.bottom} Z`
      : ''

  return (
    <div className="line-chart" role="group" aria-label={`График: ${data.map((item) => `${item.label} ${item.value ?? '—'}`).join(', ')}`}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={tones[tone]} stopOpacity="0.28" />
            <stop offset="100%" stopColor={tones[tone]} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((fraction) => {
          const y = padding.top + fraction * (height - padding.top - padding.bottom)
          return <line key={fraction} x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="var(--border)" strokeDasharray="3 4" />
        })}
        {areaPath ? <path d={areaPath} fill={`url(#${gradientId})`} /> : null}
        {path ? <path className="line-path" d={path} fill="none" stroke={tones[tone]} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" /> : null}
        {points.map((entry, index) =>
          entry ? (
            <g key={data[index]?.label ?? index} tabIndex={0} className="chart-point" aria-label={`${data[index]?.label}: ${data[index]?.value}${unit}`}>
              <circle cx={entry.x} cy={entry.y} r={9} fill={tones[tone]} opacity={0.12} />
              <circle cx={entry.x} cy={entry.y} r={4} fill={tones[tone]}>
                <title>{`${data[index]?.label}: ${data[index]?.value}${unit}`}</title>
              </circle>
            </g>
          ) : null,
        )}
        {data.map((item, index) => (
          <text key={`${item.label}-${index}`} x={point(0, index).x} y={height - 6} textAnchor="middle" className="chart-axis">
            {item.label}
          </text>
        ))}
        <text x={4} y={padding.top + 4} className="chart-axis">{max}{unit}</text>
        <text x={4} y={height - padding.bottom} className="chart-axis">{min}{unit}</text>
      </svg>
      <ul className="sr-only">
        {data.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            {item.label}: {item.value ?? '—'}{unit}
          </li>
        ))}
      </ul>
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
