import assert from 'node:assert/strict'
import test from 'node:test'
import worker from './worker.js'

/**
 * Поведение Worker'а сайта без сети и без wrangler: `fetch` вызывается напрямую.
 *
 * Проверяется то, что видит посетитель, когда API ещё не подключён: код и
 * текст ответа для отправки заявки, ответы остальных /api-маршрутов, прокси
 * на API_ORIGIN и SPA-фолбэк для глубоких ссылок.
 */

const SITE = 'https://site.test'

/** Каталог ассетов: всё существует, кроме перечисленных путей. */
function staticAssets(missing = []) {
  return {
    fetch: async (request) => {
      const { pathname } = new URL(request.url)
      return missing.includes(pathname) ? new Response('not found', { status: 404 }) : new Response('asset')
    },
  }
}

function call(path, { method = 'GET', env = {}, body } = {}) {
  return worker.fetch(new Request(`${SITE}${path}`, { method, body }), {
    ASSETS: staticAssets(),
    ...env,
  })
}

test('POST /api/leads без API_ORIGIN отвечает 503 с понятным посетителю текстом', async () => {
  const response = await call('/api/leads', {
    method: 'POST',
    body: JSON.stringify({ name: 'Тест', phone: '+996700123456', consent: true }),
  })

  assert.equal(response.status, 503)
  const body = await response.json()
  assert.equal(body.error.code, 'LEADS_UNAVAILABLE')
  assert.match(body.error.message, /Приём заявок временно недоступен/)
  // Техническая инструкция про API_ORIGIN не должна попадать на лендинг.
  assert.doesNotMatch(body.error.message, /API_ORIGIN/)
})

test('остальные маршруты /api без API_ORIGIN получают API_NOT_CONFIGURED', async () => {
  for (const [path, method] of [
    ['/api/branding', 'GET'],
    ['/api/leads', 'GET'],
    ['/api/auth/login', 'POST'],
  ]) {
    const response = await call(path, { method })
    assert.equal(response.status, 503, `${method} ${path}`)
    const body = await response.json()
    assert.equal(body.error.code, 'API_NOT_CONFIGURED', `${method} ${path}`)
    // Форма входа показывает это сообщение посетителю: никаких имён настроек.
    assert.match(body.error.message, /^Сервер ITadis временно недоступен\./)
    assert.doesNotMatch(body.error.message, /API_ORIGIN|undefined|null/)
  }
})

test('с API_ORIGIN запрос уходит на backend вместе с query', async () => {
  const calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (request) => {
    calls.push({ url: request.url, method: request.method })
    return new Response(JSON.stringify({ proxied: true }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    })
  }

  try {
    const response = await call('/api/leads?utm=landing', {
      method: 'GET',
      env: { API_ORIGIN: 'https://api.test' },
    })

    assert.equal(response.status, 201)
    assert.deepEqual(calls, [{ url: 'https://api.test/api/leads?utm=landing', method: 'GET' }])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('глубокие ссылки получают SPA-фолбэк, остальные 404 пропускаются', async () => {
  const env = { ASSETS: staticAssets(['/dashboard', '/app/mentor', '/missing.txt']) }

  const landing = await worker.fetch(new Request(`${SITE}/dashboard`), env)
  assert.equal(landing.status, 200)

  const cabinet = await worker.fetch(new Request(`${SITE}/app/mentor`), env)
  assert.equal(cabinet.status, 200)

  // Отсутствующий GET-ассет тоже уходит в фолбэк: это цена клиентской маршрутизации.
  const missingAsset = await worker.fetch(new Request(`${SITE}/missing.txt`), env)
  assert.equal(missingAsset.status, 200)

  // Не-GET запросы не переписываются, иначе ошибки API теряли бы код.
  const missingPost = await worker.fetch(new Request(`${SITE}/dashboard`, { method: 'POST' }), env)
  assert.equal(missingPost.status, 404)
})

test('/app редиректит на /app/', async () => {
  const response = await worker.fetch(new Request(`${SITE}/app`), { ASSETS: staticAssets() })

  assert.equal(response.status, 308)
  assert.equal(response.headers.get('location'), `${SITE}/app/`)
})
