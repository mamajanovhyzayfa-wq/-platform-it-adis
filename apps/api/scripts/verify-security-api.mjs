/**
 * Финальная проверка экосистемы: RBAC, единый формат ошибок, устойчивость Prisma
 * к инъекциям и пагинация списков.
 * Запуск: node scripts/verify-security-api.mjs (сервер на :4000, seed применён).
 */
const base = process.env.API_URL ?? 'http://localhost:4000/api'
let failures = 0

function check(name, condition, details) {
  if (condition) {
    console.log(`  ok  ${name}`)
  } else {
    failures += 1
    console.log(`FAIL  ${name}`, details === undefined ? '' : JSON.stringify(details).slice(0, 500))
  }
}

async function call(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  })
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: response.status, body }
}

async function login(identifier) {
  const response = await call('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password: 'ITadis2026' }),
  })
  return response.body?.tokens?.accessToken
}

const origin = new URL(base).origin
const health = await fetch(`${origin}/healthz`).then(async (response) => ({ status: response.status, body: await response.json() }))
check('health отвечает 200 и видит БД', health.status === 200 && health.body?.database === 'up', health)

const [adminToken, teacherToken, studentToken] = await Promise.all([
  login('admin@itadis.kg'),
  login('teacher@itadis.kg'),
  login('student@itadis.kg'),
])
check('вход трёх ролей', Boolean(adminToken) && Boolean(teacherToken) && Boolean(studentToken))

const as = (token) => ({ authorization: `Bearer ${token}` })

// --- 401 / 403 ---------------------------------------------------------------
const anonymous = await call('/admin/dashboard')
check('без токена админка отдаёт 401', anonymous.status === 401 && anonymous.body?.error?.code === 'UNAUTHORIZED', anonymous)

for (const path of ['/admin/dashboard', '/admin/users', '/admin/audit-logs', '/admin/coin-transactions']) {
  const response = await call(path, { headers: as(studentToken) })
  check(`ученик получает 403 на ${path}`, response.status === 403 && response.body?.error?.code === 'FORBIDDEN', response)
}

const teacherAdmin = await call('/admin/users', { headers: as(teacherToken) })
check('преподаватель получает 403 на /admin/users', teacherAdmin.status === 403, teacherAdmin)

const studentSchedule = await call('/schedule', {
  method: 'POST',
  headers: as(studentToken),
  body: JSON.stringify({ courseId: '00000000-0000-4000-8000-000000000000', title: 'Тест', startsAt: new Date().toISOString() }),
})
check('ученик не может создать занятие', studentSchedule.status === 403, studentSchedule)

const studentModule = await call('/courses/00000000-0000-4000-8000-000000000000/modules', {
  method: 'POST',
  headers: as(studentToken),
  body: JSON.stringify({ title: 'Модуль ученика' }),
})
check('ученик не может создать модуль курса', studentModule.status === 403, studentModule)

const studentLesson = await call('/lessons', {
  method: 'POST',
  headers: as(studentToken),
  body: JSON.stringify({ moduleId: '00000000-0000-4000-8000-000000000000', title: 'Урок ученика' }),
})
check('ученик не может создать урок', studentLesson.status === 403 || studentLesson.status === 404, studentLesson)

// --- Доступ администратора ---------------------------------------------------
const dashboard = await call('/admin/dashboard', { headers: as(adminToken) })
check('админ открывает сводку', dashboard.status === 200 && typeof dashboard.body?.users?.total === 'number', dashboard)

const usersPage1 = await call('/admin/users?page=1&limit=2', { headers: as(adminToken) })
const usersPage2 = await call('/admin/users?page=2&limit=2', { headers: as(adminToken) })
check(
  'пользователи отдаются страницами',
  usersPage1.status === 200 &&
    Array.isArray(usersPage1.body?.items) &&
    usersPage1.body.items.length === 2 &&
    usersPage2.body?.items?.[0]?.id !== usersPage1.body?.items?.[0]?.id,
  { first: usersPage1.body?.items?.[0]?.id, second: usersPage2.body?.items?.[0]?.id },
)

const audit = await call('/admin/audit-logs?limit=5', { headers: as(adminToken) })
check('журнал аудита доступен админу', audit.status === 200 && Array.isArray(audit.body?.items), audit)

// --- Ошибки и валидация ------------------------------------------------------
const studentId = usersPage1.body?.items?.find((item) => item.role === 'STUDENT')?.id
const badRole = await call(`/admin/users/${studentId}`, {
  method: 'PATCH',
  headers: as(adminToken),
  body: JSON.stringify({ role: 'SUPERUSER' }),
})
check(
  'недопустимая роль отклоняется с 422 и единым форматом',
  badRole.status === 422 && badRole.body?.error?.code === 'VALIDATION_ERROR' && Array.isArray(badRole.body?.error?.details),
  badRole,
)

const badId = await call('/admin/users/not-a-uuid', {
  method: 'PATCH',
  headers: as(adminToken),
  body: JSON.stringify({ isActive: false }),
})
check('некорректный UUID не даёт 500', badId.status === 404 || badId.status === 422, badId)

const unknownRoute = await call('/definitely-not-a-route')
check('неизвестный маршрут отдаёт 404 в едином формате', unknownRoute.status === 404 && unknownRoute.body?.error?.code === 'NOT_FOUND', unknownRoute)

// --- Prisma: параметризованные запросы ---------------------------------------
const injection = "' OR 1=1 --"
const catalogInjection = await call(`/courses?search=${encodeURIComponent(injection)}&limit=50`, { headers: as(studentToken) })
check(
  'инъекция в поиске курсов не раскрывает данные',
  catalogInjection.status === 200 && Array.isArray(catalogInjection.body?.items) && catalogInjection.body.items.length === 0,
  { status: catalogInjection.status, count: catalogInjection.body?.items?.length },
)

const adminInjection = await call(`/admin/users?search=${encodeURIComponent("' OR '1'='1")}&limit=100`, { headers: as(adminToken) })
check(
  'инъекция в поиске пользователей не раскрывает данные',
  adminInjection.status === 200 && (adminInjection.body?.items?.length ?? 0) === 0,
  { status: adminInjection.status, count: adminInjection.body?.items?.length },
)

// --- Пагинация списков -------------------------------------------------------
const notifications = await call('/notifications?limit=2&offset=0', { headers: as(studentToken) })
const notificationsNext = await call('/notifications?limit=2&offset=2', { headers: as(studentToken) })
check(
  'уведомления поддерживают offset и total',
  notifications.status === 200 &&
    typeof notifications.body?.total === 'number' &&
    Array.isArray(notifications.body?.items) &&
    (notifications.body.items.length < 2 || notifications.body.items[0].id !== notificationsNext.body?.items?.[0]?.id),
  { total: notifications.body?.total },
)

const coins = await call('/coins/history?limit=1&offset=0', { headers: as(studentToken) })
check(
  'история IT Coins отдаёт total и totals',
  coins.status === 200 && typeof coins.body?.total === 'number' && typeof coins.body?.totals?.earned === 'number',
  coins.body,
)

const submissions = await call('/teacher/submissions?status=ALL&limit=2&offset=0', { headers: as(teacherToken) })
check(
  'очередь работ поддерживает пагинацию',
  submissions.status === 200 && typeof submissions.body?.total === 'number' && Array.isArray(submissions.body?.items),
  submissions.body,
)

// --- Приватность профиля -----------------------------------------------------
const teacherProfile = await call('/users/me', { headers: as(teacherToken) })
const foreignProfile = await call(`/users/${teacherProfile.body?.id}`, { headers: as(studentToken) })
check(
  'ученик не видит чужой профиль',
  teacherProfile.body?.id ? foreignProfile.status === 404 : true,
  { status: foreignProfile.status },
)

console.log(failures === 0 ? '\nВсе проверки пройдены.' : `\nПровалено проверок: ${failures}`)
process.exit(failures === 0 ? 0 : 1)
