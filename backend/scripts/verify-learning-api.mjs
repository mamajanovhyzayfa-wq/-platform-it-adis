/**
 * Сквозная проверка учебного контура: каталог, сводка, курс, запись, урок и прогресс.
 * Запуск: node scripts/verify-learning-api.mjs (сервер должен быть запущен на :4000).
 */
const base = process.env.API_URL ?? 'http://localhost:4000/api'
let failures = 0

function check(name, condition, details) {
  if (condition) {
    console.log(`  ok  ${name}`)
  } else {
    failures += 1
    console.log(`FAIL  ${name}`, details === undefined ? '' : JSON.stringify(details).slice(0, 400))
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

const login = await call('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ identifier: 'student@itadis.kg', password: 'ITadis2026' }),
})
check('вход ученика', login.status === 200 && Boolean(login.body?.tokens?.accessToken), login)

const token = login.body?.tokens?.accessToken
const auth = { authorization: `Bearer ${token}` }

const categories = await call('/courses/categories', { headers: auth })
check('категории курсов', categories.status === 200 && categories.body.items.length >= 6, categories)

const catalog = await call('/courses?limit=10', { headers: auth })
check('каталог курсов', catalog.status === 200 && catalog.body.items.length >= 5, catalog)
const card = catalog.body?.items?.[0]
check(
  'карточка каталога содержит категорию и счётчики',
  Boolean(card?.category?.title) && typeof card?.lessonsCount === 'number' && typeof card?.studentsCount === 'number',
  card,
)

const search = await call('/courses?search=python', { headers: auth })
check(
  'поиск по каталогу',
  search.status === 200 && search.body.items.length === 1 && /python/i.test(search.body.items[0].title),
  search.body,
)

const filtered = await call('/courses?category=react&level=INTERMEDIATE', { headers: auth })
check(
  'фильтр по категории и уровню',
  filtered.status === 200 && filtered.body.items.length === 1 && filtered.body.items[0].slug === 'react-professional',
  filtered.body,
)

const mine = await call('/courses/my', { headers: auth })
check('мои курсы', mine.status === 200 && mine.body.items.length >= 3, mine.body)
check('у курса есть следующий урок', mine.body?.items?.some((item) => item.nextLesson?.id), mine.body)

const overview = await call('/courses/overview', { headers: auth })
check('сводка главного экрана', overview.status === 200 && overview.body.coinBalance >= 0, overview)
check('сводка содержит прогресс и курсы', typeof overview.body?.overallProgress === 'number' && Array.isArray(overview.body?.activeCourses), overview.body)

// Детали смотрим у курса, на который ученик записан: иначе уроки закрыты.
const courseId = mine.body.items.find((item) => item.nextLesson?.id)?.course.id ?? card.id
const detail = await call(`/courses/${courseId}`, { headers: auth })
check(
  'детали курса: модули и уроки',
  detail.status === 200 && detail.body.modules.length > 0 && detail.body.modules[0].lessons.length > 0,
  detail.body,
)

const python = await call('/courses?search=python', { headers: auth })
const pythonId = python.body.items[0].id
const enroll = await call(`/courses/${pythonId}/enroll`, { method: 'POST', headers: auth })
check('запись на курс', enroll.status === 201 && Boolean(enroll.body?.enrollment?.id), enroll)

const lessonId = detail.body.modules[0].lessons[0].id
const lesson = await call(`/lessons/${lessonId}`, { headers: auth })
check(
  'урок: конспект, видео, материалы',
  lesson.status === 200 && Boolean(lesson.body.content) && Boolean(lesson.body.videoUrl) && Array.isArray(lesson.body.materials),
  lesson.body,
)
check('урок: навигация', lesson.body.prevLesson === null && Boolean(lesson.body.nextLesson?.id), lesson.body)

const progress = await call(`/lessons/${lessonId}/progress`, {
  method: 'PATCH',
  headers: auth,
  body: JSON.stringify({ positionSeconds: 42 }),
})
check('сохранение позиции', progress.status === 200 && progress.body.lastPositionSeconds === 42, progress)

const complete = await call(`/lessons/${lessonId}/complete`, { method: 'POST', headers: auth })
check(
  'завершение урока и пересчёт прогресса',
  complete.status === 201 && complete.body.progress >= 0 && complete.body.completedLessons >= 1,
  complete,
)

const forbidden = await call('/courses/overview')
check('сводка закрыта без токена', forbidden.status === 401, forbidden)

// Управление уроками преподавателем: создание черновика, правка и удаление.
const teacherLogin = await call('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ identifier: 'teacher@itadis.kg', password: 'ITadis2026' }),
})
const teacherAuth = { authorization: `Bearer ${teacherLogin.body?.tokens?.accessToken}` }
const created = await call('/lessons', {
  method: 'POST',
  headers: teacherAuth,
  body: JSON.stringify({
    moduleId: detail.body.modules[0].id,
    title: 'Проверочный урок API',
    durationMinutes: 5,
    published: false,
  }),
})
check('преподаватель создаёт урок', created.status === 201 && created.body.publishedAt === null, created)

const updated = await call(`/lessons/${created.body?.id}`, {
  method: 'PATCH',
  headers: teacherAuth,
  body: JSON.stringify({ title: 'Проверочный урок API (обновлён)' }),
})
check('преподаватель правит урок', updated.status === 200 && updated.body.title.includes('обновлён'), updated)

const removed = await call(`/lessons/${created.body?.id}`, { method: 'DELETE', headers: teacherAuth })
check('преподаватель удаляет черновик', removed.status === 204, removed)

const studentDenied = await call('/lessons', {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ moduleId: detail.body.modules[0].id, title: 'Нельзя' }),
})
check('ученик не может создавать уроки', studentDenied.status === 403, studentDenied)

console.log(failures === 0 ? '\nВсе проверки пройдены.' : `\nПровалено проверок: ${failures}`)
process.exit(failures === 0 ? 0 : 1)
