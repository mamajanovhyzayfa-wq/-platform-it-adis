const base = 'http://localhost:4000'

const results = []
function check(name, ok, extra = '') {
  results.push({ name, ok, extra })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`)
}

async function req(path, { method = 'GET', token, body, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
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

  // 3.1 Подтверждение личности для необратимых операций
  const stepUp = await req('/api/auth/step-up', {
    method: 'POST',
    token: tokens.ADMIN.accessToken,
    body: { password: 'ITadis2026' },
  })
  const stepUpHeaders = stepUp.data?.stepUpToken ? { 'x-step-up-token': stepUp.data.stepUpToken } : {}

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

  // 10. Регистрация — только заявка; аккаунт появляется после решения администратора
  const email = `qa.student.${Date.now()}@itadis.kg`
  const registered = await req('/api/access/registration', {
    method: 'POST',
    body: {
      firstName: 'Тест',
      lastName: 'Ученик',
      email,
      password: 'ITadis2026',
      passwordRepeat: 'ITadis2026',
      birthDate: '1998-05-12',
      acceptTerms: true,
      acceptPrivacy: true,
      acceptDataProcessing: true,
    },
  })
  check(
    'Заявка на регистрацию → 201 PENDING',
    registered.status === 201 && registered.data.status === 'PENDING',
    JSON.stringify(registered.data?.error ?? ''),
  )
  const impossibleLogin = await login(email)
  check('До одобрения аккаунт не создан → 401', impossibleLogin.status === 401)

  const registrations = await req('/api/access/registrations?status=PENDING', { token: tokens.ADMIN.accessToken })
  const pending = Array.isArray(registrations.data)
    ? registrations.data.find((item) => item.email === email)
    : null
  check('Администратор видит заявку', registrations.status === 200 && Boolean(pending), `id=${pending?.id}`)

  const approved = pending
          ? await req(`/api/access/registrations/${pending.id}/decision`, {
        method: 'POST',
        token: tokens.ADMIN.accessToken,
        headers: stepUpHeaders,
        body: { approve: true },
      })
    : { status: 0, data: null }
  check(
    'Одобрение заявки создаёт STUDENT',
    approved.status === 201 || approved.status === 200,
    JSON.stringify(approved.data?.error ?? approved.data),
  )
  const studentLogin = await login(email)
  check(
    'После одобрения ученик входит',
    studentLogin.status === 200 && studentLogin.data.user.role === 'STUDENT',
    `status=${studentLogin.status}`,
  )
  const newMe = await req('/api/users/me', { token: studentLogin.data?.tokens?.accessToken })
  check('Новый ученик видит свой профиль', newMe.status === 200 && newMe.data.email === email)

  // 10.1 Мгновенное удаление запрещено: аккаунт удаляется только по заявке,
  // которую рассматривает администратор (защита от случайной потери данных).
  const removed = await req('/api/users/me', { method: 'DELETE', token: studentLogin.data?.tokens?.accessToken })
  check('DELETE /api/users/me требует заявку → 409', removed.status === 409, JSON.stringify(removed.data?.error?.message))
  const afterRemoval = await req('/api/users/me', { token: studentLogin.data?.tokens?.accessToken })
  check(
    'До решения администратора профиль сохраняется',
    afterRemoval.status === 200 && afterRemoval.data.email === email,
    JSON.stringify(afterRemoval.data?.error?.message),
  )

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
