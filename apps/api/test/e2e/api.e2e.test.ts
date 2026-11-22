import { describe, expect, it } from 'vitest'

/**
 * End-to-end проверки запущенного стенда.
 *
 * Запуск:
 *   E2E_BASE_URL=http://primary.local:4000 \
 *   E2E_ADMIN_EMAIL=admin@itadis.kg \
 *   E2E_ADMIN_PASSWORD='ITadis2026' \
 *   E2E_BRANCH_B_URL=http://branch-b.example.com \
 *   npm run test:e2e
 *
 * Если E2E_BASE_URL не задан, файл пропускается. Если задан, остальные
 * параметры обязательны: раньше отсутствие логина или второго домена
 * молча пропускало половину сценариев, и CI мог быть «зелёным» без них.
 *
 * Токен филиала A больше не передаётся переменной: тест сам входит
 * администратором на E2E_BASE_URL, поэтому проверяется ещё и вход.
 */
function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(
      `Для e2e задайте ${name}. Нужны E2E_BASE_URL, E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD и E2E_BRANCH_B_URL.`,
    )
  }
  return value
}

interface E2EConfig {
  baseUrl: string
  adminEmail: string
  adminPassword: string
  branchBUrl: string
}

function loadConfig(): E2EConfig | null {
  const baseUrl = process.env.E2E_BASE_URL?.trim()
  if (!baseUrl) return null
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    adminEmail: requiredEnv('E2E_ADMIN_EMAIL'),
    adminPassword: requiredEnv('E2E_ADMIN_PASSWORD'),
    branchBUrl: requiredEnv('E2E_BRANCH_B_URL').replace(/\/$/, ''),
  }
}

const config = loadConfig()
const suite = config ? describe : describe.skip
const e2e = config ?? { baseUrl: '', adminEmail: '', adminPassword: '', branchBUrl: '' }

suite('API e2e: запущенный стенд', () => {
  const { baseUrl, adminEmail, adminPassword, branchBUrl } = e2e
  // Вход ленивый: ошибка авторизации должна падать в тесте, а не помечать
  // весь набор как skipped, как это делает упавший beforeAll.
  let adminTokenPromise: Promise<string> | undefined

  function getAdminToken(): Promise<string> {
    adminTokenPromise ??= (async () => {
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: adminEmail, password: adminPassword }),
      })
      const text = await response.text()
      if (response.status !== 200) {
        throw new Error(`Вход администратора не удался: ${response.status} ${text.slice(0, 300)}`)
      }
      const session = JSON.parse(text) as { tokens?: { accessToken?: string }; twoFactorRequired?: boolean }
      if (session.twoFactorRequired) throw new Error('У администратора включена 2FA, e2e нужен аккаунт без 2FA')
      if (!session.tokens?.accessToken) throw new Error('Ответ входа не содержит access-токен')
      return session.tokens.accessToken
    })()
    return adminTokenPromise
  }

  it('healthz сообщает состояние сервиса', async () => {
    const response = await fetch(`${baseUrl}/healthz`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { status: string; database: string }
    // Стенд для e2e обязан быть полностью поднят: на degraded дальнейшие
    // сценарии с БД всё равно упадут, но с менее понятной причиной.
    expect(body.status).toBe('ok')
    expect(body.database).toBe('up')
  })

  it('заявка на регистрацию с коротким паролем отклоняется с 422', async () => {
    const response = await fetch(`${baseUrl}/api/access/registration`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'e2e@itadis.kg',
        password: '123',
        passwordRepeat: '123',
        firstName: 'E2E',
        lastName: 'Test',
        acceptTerms: true,
        acceptPrivacy: true,
        acceptDataProcessing: true,
      }),
    })
    expect(response.status).toBe(422)
    const body = (await response.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('VALIDATION_ERROR')
  })

  it('закрытый маршрут без токена отвечает 401', async () => {
    const response = await fetch(`${baseUrl}/api/users/me`)
    expect(response.status).toBe(401)
  })

  it('восстановление пароля не раскрывает существование аккаунта', async () => {
    const unknown = await fetch(`${baseUrl}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'no-such-user-e2e@itadis.kg' }),
    })
    const known = await fetch(`${baseUrl}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail }),
    })
    expect(unknown.status).toBe(known.status)
    expect(((await unknown.json()) as { message?: string }).message).toBe(
      ((await known.json()) as { message?: string }).message,
    )
  })

  it('поддержка: создание и чтение своего обращения', async () => {
    const adminToken = await getAdminToken()
    const subject = `E2E обращение ${Date.now()}`
    const created = await fetch(`${baseUrl}/api/support/tickets`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subject,
        message: 'Проверка создания обращения из e2e-сценария, ответ не требуется.',
        category: 'TECHNICAL',
        priority: 'NORMAL',
      }),
    })
    expect(created.status).toBe(201)
    const ticket = (await created.json()) as { id: string; userId: string; status: string }
    expect(ticket.id).toBeTruthy()
    expect(ticket.userId).toBeTruthy()
    expect(ticket.status).toBe('OPEN')

    const list = await fetch(`${baseUrl}/api/support/tickets?search=${encodeURIComponent(subject)}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    expect(list.status).toBe(200)
    const page = (await list.json()) as { data: Array<{ id: string }>; total: number }
    expect(page.total).toBeGreaterThan(0)
    expect(page.data.some((item) => item.id === ticket.id)).toBe(true)
  })

  it('резервное копирование: обзор и журнал доступны администратору', async () => {
    const adminToken = await getAdminToken()
    const overview = await fetch(`${baseUrl}/api/backups/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    expect(overview.status).toBe(200)
    const body = (await overview.json()) as { branches: unknown[]; storageDriver: string }
    expect(Array.isArray(body.branches)).toBe(true)
    expect(['local', 's3']).toContain(body.storageDriver)

    const runs = await fetch(`${baseUrl}/api/backups/runs`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    expect(runs.status).toBe(200)
    const history = (await runs.json()) as { items: unknown[] }
    expect(Array.isArray(history.items)).toBe(true)
  })

  it('администратор входит и видит интеграции без секретов', async () => {
    const adminToken = await getAdminToken()
    const response = await fetch(`${baseUrl}/api/integrations`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).not.toMatch(/sk-[A-Za-z0-9]{8,}/)
    expect(text).not.toMatch(/"secret"\s*:\s*"[^"]+"/)
  })

  it('токен основного филиала не работает на домене филиала B', async () => {
    const adminToken = await getAdminToken()
    const response = await fetch(`${branchBUrl}/api/integrations`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    expect(response.status).toBe(403)
    const body = (await response.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('FOREIGN_BRANCH_TOKEN')
  })

  it('подмена филиала в query, body и заголовке не обходит Host', async () => {
    const adminToken = await getAdminToken()
    const response = await fetch(`${branchBUrl}/api/support/tickets?branchId=primary&domain=primary.local`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
        'X-Branch-Id': 'primary',
        'X-Tenant': 'primary',
      },
      body: JSON.stringify({
        subject: 'Попытка подмены филиала',
        message: 'Запрос должен быть отклонён до обработки тела.',
        category: 'TECHNICAL',
        priority: 'NORMAL',
        branchId: 'primary',
        domain: 'primary.local',
      }),
    })

    expect(response.status).toBe(403)
    const body = (await response.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('FOREIGN_BRANCH_TOKEN')
  })
})
