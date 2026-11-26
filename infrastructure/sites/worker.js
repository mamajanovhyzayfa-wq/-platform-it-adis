/**
 * Cloudflare Worker для сайта ITadis.
 *
 * Корень отдаёт лендинг, /app/ — полноценный веб-кабинет. Если задан
 * API_ORIGIN, запросы /api и /socket.io проксируются на backend; иначе
 * клиент получает ответ о ненастроенном сервере.
 */
const APP_PREFIX = '/app/'
const LEADS_PATH = '/api/leads'

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function isApiRequest(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/') || pathname.startsWith('/socket.io/')
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === '/app') {
      return Response.redirect(new URL(APP_PREFIX, url), 308)
    }

    if (isApiRequest(url.pathname)) {
      if (!env.API_ORIGIN) {
        // Посетителю лендинга не показываем техническую инструкцию про API_ORIGIN:
        // для него это просто временная недоступность приёма заявок.
        if (request.method === 'POST' && url.pathname === LEADS_PATH) {
          return json(503, {
            error: {
              code: 'LEADS_UNAVAILABLE',
              message: 'Приём заявок временно недоступен. Пожалуйста, попробуйте позже.',
            },
          })
        }
        // Текст показывается посетителю (его выводит форма входа), поэтому
        // без технических имён настроек: код в error.code достаточен для диагностики.
        return json(503, {
          error: {
            code: 'API_NOT_CONFIGURED',
            message: 'Сервер ITadis временно недоступен. Попробуйте позже или свяжитесь с администратором.',
          },
        })
      }
      return fetch(new Request(new URL(url.pathname + url.search, env.API_ORIGIN), request))
    }

    const asset = await env.ASSETS.fetch(request)
    if (asset.status !== 404 || request.method !== 'GET') return asset

    // Не используем /index.html: ассеты редиректят его на канонический /,
    // из-за чего браузер терял глубокий URL и открывал главную.
    const fallback = url.pathname.startsWith(APP_PREFIX) ? APP_PREFIX : '/'
    return env.ASSETS.fetch(new Request(new URL(fallback, url), request))
  },
}
