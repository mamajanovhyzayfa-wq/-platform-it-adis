const base = 'http://localhost:4000'

const results = []
function check(name, ok, extra = '') {
  results.push({ name, ok, extra })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`)
}

async function req(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  const text = await res.text()
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  return { status: res.status, data }
}

async function login(identifier, password = 'ITadis2026') {
  return req('/api/auth/login', { method: 'POST', body: { identifier, password } })
}

const run = async () => {
  // 1. Защита без токена
  const noToken = await req('/api/users/me')
  check('GET /api/users/me без токена → 401', noToken.status === 401, JSON.stringify(noToken.data))

  // 2. Health + БД
  const health = await req('/healthz')
  check(
    '/healthz отвечает и видит БД',
    health.status === 200 && health.data.database === 'up',
    JSON.stringify(health.data),
  )

  // 3. Вход по всем четырём ролям
  const accounts = { STUDENT: 'student@itadis.kg', TEACHER: 'teacher@itadis.kg', PARENT: 'parent@itadis.kg', ADMIN: 'admin@itadis.kg' }
  const tokens = {}
  for (const [role, email] of Object.entries(accounts)) {
    const res = await login(email)
    check(`Вход ${role}`, res.status === 200 && res.data.user.role === role, `status=${res.status}`)
    tokens[role] = res.data?.tokens
  }

  // 4. Профиль
  const me = await req('/api/users/me', { token: tokens.STUDENT.accessToken })
  check('GET /api/users/me студента', me.status === 200 && me.data.email === accounts.STUDENT, `coins=${me.data?.coinBalance}`)

  // 5. PATCH профиля
  const patch = await req('/api/users/me', {
    method: 'PATCH',
    token: tokens.STUDENT.accessToken,
    body: { locale: 'en', bio: 'Тест обновления профиля' },
  })
  check(
    'PATCH /api/users/me обновляет профиль',
    patch.status === 200 && patch.data.locale === 'en' && patch.data.profile?.bio === 'Тест обновления профиля',
    `status=${patch.status}`,
  )
  await req('/api/users/me', { method: 'PATCH', token: tokens.STUDENT.accessToken, body: { locale: 'ru' } })

  // 6. Валидация
  const invalid = await req('/api/users/me', { method: 'PATCH', token: tokens.STUDENT.accessToken, body: { locale: 'de' } })
  check('PATCH с невалидной локалью → 422', invalid.status === 422, JSON.stringify(invalid.data?.error?.code))

  // 7. RBAC: ученик против преподавателя
  const studentStudents = await req('/api/users/me/students', { token: tokens.STUDENT.accessToken })
  check('Ученик в /me/students → 403', studentStudents.status === 403, JSON.stringify(studentStudents.data?.error?.message))

  const teacherStudents = await req('/api/users/me/students', { token: tokens.TEACHER.accessToken })
  check('Преподаватель в /me/students → 200', teacherStudents.status === 200, `items=${teacherStudents.data?.items?.length}`)

  // 8. Права роли
  const adminPerms = await req('/api/users/me/permissions', { token: tokens.ADMIN.accessToken })
  check(
    'ADMIN получает права из БД',
    adminPerms.status === 200 && adminPerms.data.permissions.includes('users.manage'),
    JSON.stringify(adminPerms.data?.permissions),
  )
  const parentPerms = await req('/api/users/me/permissions', { token: tokens.PARENT.accessToken })
  check(
    'PARENT не имеет административных прав',
    parentPerms.status === 200 && parentPerms.data.permissions.length === 0,
    JSON.stringify(parentPerms.data),
  )

  // 9. Ротация refresh-токена и детект повторного использования
  const first = await req('/api/auth/refresh', { method: 'POST', body: { refreshToken: tokens.PARENT.refreshToken } })
  check('Refresh возвращает новую пару', first.status === 200 && first.data.tokens.refreshToken !== tokens.PARENT.refreshToken)
  const reuse = await req('/api/auth/refresh', { method: 'POST', body: { refreshToken: tokens.PARENT.refreshToken } })
  check('Повторное использование старого refresh → 401', reuse.status === 401, JSON.stringify(reuse.data?.error?.message))
  const revokedChain = await req('/api/auth/refresh', { method: 'POST', body: { refreshToken: first.data.tokens.refreshToken } })
  check('После кражи семейство сессий отозвано', revokedChain.status === 401, JSON.stringify(revokedChain.data?.error?.message))

  // 10. Регистрация создаёт профиль ученика и согласия
  const email = `qa.student.${Date.now()}@itadis.kg`
  const registered = await req('/api/auth/register', {
    method: 'POST',
    body: {
      firstName: 'Тест',
      lastName: 'Ученик',
      email,
      password: 'ITadis2026',
      passwordRepeat: 'ITadis2026',
      acceptTerms: true,
      acceptPrivacy: true,
      birthDate: '2010-05-01',
      guardianName: 'Тест Родитель',
      guardianPhone: '+996700009999',
      deviceId: 'qa-device-1',
      platform: 'android',
    },
  })
  check(
    'Регистрация → 201 со STUDENT',
    registered.status === 201 && registered.data.user.role === 'STUDENT',
    JSON.stringify(registered.data?.error ?? ''),
  )
  const newMe = await req('/api/users/me', { token: registered.data?.tokens?.accessToken })
  check('Новый ученик видит свой профиль', newMe.status === 200 && newMe.data.email === email)

  // 10.1 Удаление аккаунта (обезличивание) — тест не оставляет мусор в БД.
  const removed = await req('/api/users/me', { method: 'DELETE', token: registered.data?.tokens?.accessToken })
  check('DELETE /api/users/me → 204', removed.status === 204)
  const afterRemoval = await req('/api/users/me', { token: registered.data?.tokens?.accessToken })
  check('После удаления профиль недоступен', afterRemoval.status === 401, JSON.stringify(afterRemoval.data?.error?.message))

  // 11. Rate limiting
  let limited = 0
  for (let i = 0; i < 25; i += 1) {
    const attempt = await req('/api/auth/login', {
      method: 'POST',
      body: { identifier: 'qa.nobody@itadis.kg', password: 'wrong-password' },
    })
    if (attempt.status === 429) {
      limited = i + 1
      break
    }
  }
  check('Rate limiting срабатывает на 21-й попытке', limited > 0 && limited <= 21, `429 на попытке ${limited}`)

  const failed = results.filter((r) => !r.ok)
  console.log(`\nИТОГО: ${results.length - failed.length}/${results.length} проверок пройдено`)
  process.exit(failed.length ? 1 : 0)
}

run().catch((error) => {
  console.error('Ошибка выполнения проверок:', error)
  process.exit(1)
})
