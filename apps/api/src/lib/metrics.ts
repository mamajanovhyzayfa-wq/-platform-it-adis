import type { NextFunction, Request, Response } from 'express'

/**
 * Минимальные Prometheus-метрики без внешнего агента: процесс, HTTP-запросы,
 * ошибки и задержки. Секреты и тела запросов не собираются.
 */
const httpRequests = new Map<string, number>()
const httpErrors = new Map<string, number>()
const durations = new Map<string, { sum: number; count: number }>()

function key(method: string, route: string, status?: number): string {
  return `${method}|${route}${status ? `|${status}` : ''}`
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const started = process.hrtime.bigint()
  res.on('finish', () => {
    // route.path доступен после маршрутизации; для 404 используем normalised path.
    const route = req.route?.path ?? (req.baseUrl || req.path || 'unknown')
    const normalized = String(route).replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id').replace(/\/\d+/g, '/:id')
    const status = res.statusCode
    const requestKey = key(req.method, normalized)
    httpRequests.set(requestKey, (httpRequests.get(requestKey) ?? 0) + 1)
    if (status >= 400) {
      const errorKey = key(req.method, normalized, status)
      httpErrors.set(errorKey, (httpErrors.get(errorKey) ?? 0) + 1)
    }
    const duration = Number(process.hrtime.bigint() - started) / 1e9
    const current = durations.get(requestKey) ?? { sum: 0, count: 0 }
    current.sum += duration
    current.count += 1
    durations.set(requestKey, current)
  })
  next()
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

export function renderMetrics(): string {
  const lines: string[] = [
    '# HELP itadis_process_uptime_seconds Process uptime in seconds.',
    '# TYPE itadis_process_uptime_seconds gauge',
    `itadis_process_uptime_seconds ${process.uptime().toFixed(3)}`,
    '# HELP itadis_process_resident_memory_bytes Resident memory size in bytes.',
    '# TYPE itadis_process_resident_memory_bytes gauge',
    `itadis_process_resident_memory_bytes ${process.memoryUsage().rss}`,
    '# HELP itadis_http_requests_total Total HTTP requests.',
    '# TYPE itadis_http_requests_total counter',
  ]

  for (const [label, count] of httpRequests) {
    const [method = '', route = ''] = label.split('|')
    lines.push(`itadis_http_requests_total{method="${escapeLabel(method)}",route="${escapeLabel(route)}"} ${count}`)
  }
  lines.push(
    '# HELP itadis_http_errors_total HTTP responses with status >= 400.',
    '# TYPE itadis_http_errors_total counter',
  )
  for (const [label, count] of httpErrors) {
    const [method = '', route = '', status = ''] = label.split('|')
    lines.push(
      `itadis_http_errors_total{method="${escapeLabel(method)}",route="${escapeLabel(route)}",status="${escapeLabel(status)}"} ${count}`,
    )
  }
  lines.push(
    '# HELP itadis_http_request_duration_seconds_sum Sum of request durations.',
    '# TYPE itadis_http_request_duration_seconds_sum counter',
  )
  for (const [label, value] of durations) {
    const [method = '', route = ''] = label.split('|')
    lines.push(
      `itadis_http_request_duration_seconds_sum{method="${escapeLabel(method)}",route="${escapeLabel(route)}"} ${value.sum.toFixed(6)}`,
    )
  }
  return `${lines.join('\n')}\n`
}
