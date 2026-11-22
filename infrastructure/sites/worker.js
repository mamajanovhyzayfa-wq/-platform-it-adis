/**
 * Cloudflare Worker для сайта ITadis.
 *
 * Корень отдаёт лендинг, /app/ — полноценный веб-кабинет. Если задан
 * API_ORIGIN, запросы /api и /socket.io проксируются на backend; иначе
 * клиент получает понятный ответ о ненастроенном сервере.
 */
const APP_PREFIX = '/app/'

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function proxyToApi(request, url, origin) {
  const target = new URL(url.pathname + url.search, origin)
  return fetch(new Request(target, request))
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === '/app') {
      return Response.redirect(new URL(`${APP_PREFIX}`, url), 308)
    }

    // Статический деплой без backend: лендинг и вход всё равно запрашивают
    // брендинг. Отдаём валидные значения по умолчанию вместо 503, чтобы
    // страница не писала ошибку в консоль и не ждала недоступный API.
    if (request.method === 'GET' && url.pathname === '/api/branding' && !env.API_ORIGIN) {
      return json(200, {
        name: 'ITadis',
        isPrimary: true,
        mainSiteUrl: null,
        logoUrl: null,
        description: null,
        contacts: null,
        directions: [],
      })
    }

    if (url.pathname.startsWith('/api/') || url.pathname === '/api' || url.pathname.startsWith('/socket.io/')) {
      if (!env.API_ORIGIN) {
        // Посетителю лендинга не показываем техническую инструкцию про API_ORIGIN:
        // для него это просто временная недоступность приёма заявок.
        const leads = url.pathname === '/api/leads'
        return json(503, {
          error: {
            code: leads ? 'LEADS_UNAVAILABLE' : 'API_NOT_CONFIGURED',
            message: leads
              ? 'Приём заявок временно недоступен. Пожалуйста, попробуйте позже.'
              : 'Сервер ITadis ещё не подключён к этому домену. Укажите адрес API в настройках сайта (API_ORIGIN).',
          },
        })
      }
      return proxyToApi(request, url, env.API_ORIGIN)
    }

    const asset = await env.ASSETS.fetch(request)
    if (asset.status !== 404 || request.method !== 'GET') return asset

    // Не используем /index.html: ассеты редиректят его на канонический /,
    // из-за чего браузер терял глубокий URL и открывал главную.
    const fallback = url.pathname.startsWith(APP_PREFIX) ? APP_PREFIX : '/'
    return env.ASSETS.fetch(new Request(new URL(fallback, url), request))
  },
}
