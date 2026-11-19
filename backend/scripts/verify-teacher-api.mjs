/**
 * Сквозная проверка кабинета преподавателя.
 *
 * Запускает реальные запросы к API: сводка, курсы, создание модуля и урока,
 * публикация, удаление, очередь работ, оценивание и уведомление ученику.
 *
 * Запуск: node scripts/verify-teacher-api.mjs (сервер должен быть запущен).
 */
import { randomUUID } from 'node:crypto'

const API = process.env.API_URL ?? 'http://localhost:4000/api'
const PASSWORD = 'ITadis2026'

let passed = 0
let failed = 0

function check(condition, title, details) {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${title}`)
  } else {
    failed += 1
    console.error(`  ✗ ${title}${details ? `\n    ${JSON.stringify(details)}` : ''}`)
  }
}

async function request(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  return { status: response.status, data }
}

async function login(identifier) {
  const result = await request('/auth/login', {
    method: 'POST',
    body: { identifier, password: PASSWORD, deviceId: `verify-teacher-${randomUUID()}` },
  })
  if (result.status !== 200) throw new Error(`Не удалось войти как ${identifier}: ${JSON.stringify(result.data)}`)
  return result.data.tokens.accessToken
}

async function main() {
  console.log('Проверка API кабинета преподавателя\n')

  const teacherToken = await login('teacher@itadis.kg')
  const studentToken = await login('student@itadis.kg')

  const overview = await request('/teacher/overview', { token: teacherToken })
  check(overview.status === 200, 'GET /teacher/overview отвечает 200', overview.data)
  check(overview.data?.stats?.courses >= 1, 'в сводке есть курс преподавателя', overview.data?.stats)
  check(typeof overview.data?.stats?.pendingReviews === 'number', 'в сводке есть счётчик работ на проверке')

  const courses = await request('/teacher/courses', { token: teacherToken })
  check(courses.status === 200 && Array.isArray(courses.data?.items), 'GET /teacher/courses отдаёт список')
  const course = courses.data?.items?.[0]
  check(Boolean(course?.id), 'получен курс с идентификатором')

  const detail = await request(`/teacher/courses/${course.id}`, { token: teacherToken })
  check(detail.status === 200 && Array.isArray(detail.data?.modules), 'GET /teacher/courses/:id отдаёт модули')
  check(typeof detail.data?.avgProgress === 'number', 'в карточке курса есть средний прогресс')

  const moduleTitle = `Проверка модуля ${Date.now()}`
  const createdModule = await request(`/courses/${course.id}/modules`, {
    method: 'POST',
    token: teacherToken,
    body: { title: moduleTitle, description: 'Создан автоматической проверкой' },
  })
  check(createdModule.status === 201 && createdModule.data?.id, 'POST /courses/:id/modules создаёт модуль', createdModule.data)
  const moduleId = createdModule.data?.id

  const patchedModule = await request(`/modules/${moduleId}`, {
    method: 'PATCH',
    token: teacherToken,
    body: { title: `${moduleTitle} (обновлён)` },
  })
  check(patchedModule.status === 200 && patchedModule.data?.title?.includes('обновлён'), 'PATCH /modules/:id обновляет модуль')

  const createdLesson = await request('/lessons', {
    method: 'POST',
    token: teacherToken,
    body: {
      moduleId,
      title: 'Урок из проверки',
      description: 'Тестовый урок',
      durationMinutes: 12,
      published: false,
    },
  })
  check(createdLesson.status === 201 && createdLesson.data?.id, 'POST /lessons создаёт урок', createdLesson.data)
  const lessonId = createdLesson.data?.id

  const published = await request(`/lessons/${lessonId}`, {
    method: 'PATCH',
    token: teacherToken,
    body: { published: true },
  })
  check(published.status === 200 && published.data?.publishedAt, 'PATCH /lessons/:id публикует урок')

  const unpublished = await request(`/lessons/${lessonId}`, {
    method: 'PATCH',
    token: teacherToken,
    body: { published: false },
  })
  check(unpublished.status === 200 && unpublished.data?.publishedAt === null, 'PATCH /lessons/:id снимает с публикации')

  const deletedLesson = await request(`/lessons/${lessonId}`, { method: 'DELETE', token: teacherToken })
  check(deletedLesson.status === 204, 'DELETE /lessons/:id удаляет черновик')

  const deletedModule = await request(`/modules/${moduleId}`, { method: 'DELETE', token: teacherToken })
  check(deletedModule.status === 204, 'DELETE /modules/:id удаляет пустой модуль')

  // Задания: создание и редактирование дедлайна, балла и повторной сдачи.
  const homeworkMarker = 'Автопроверка задания'
  const existingHomework = (detail.data?.homework ?? []).find((item) => item.title.startsWith(homeworkMarker))
  const dueIn = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

  let homeworkResponse = existingHomework
    ? await request(`/teacher/homework/${existingHomework.id}`, { token: teacherToken })
    : await request(`/teacher/courses/${course.id}/homework`, {
        method: 'POST',
        token: teacherToken,
        body: {
          title: homeworkMarker,
          description: 'Проверка создания задания из кабинета преподавателя',
          dueAt: dueIn(10),
          maxScore: 12,
          allowResubmit: true,
        },
      })

  if (existingHomework) {
    check(homeworkResponse.status === 200 && homeworkResponse.data?.id, 'GET /teacher/homework/:id отдаёт задание', homeworkResponse.data)
  } else {
    check(homeworkResponse.status === 201 && homeworkResponse.data?.id, 'POST /teacher/courses/:id/homework создаёт задание', homeworkResponse.data)
    check(homeworkResponse.data?.maxScore === 12, 'максимальный балл сохранён')
    check(homeworkResponse.data?.allowResubmit === true, 'повторная сдача сохранена')
    check(homeworkResponse.data?.pendingSubmissions === 0, 'у нового задания нет работ на проверке')
  }

  const homeworkId = homeworkResponse.data?.id
  check(Boolean(homeworkId), 'получен идентификатор задания')

  const updatedHomework = await request(`/teacher/homework/${homeworkId}`, {
    method: 'PATCH',
    token: teacherToken,
    body: {
      title: `${homeworkMarker} (обновлено)`,
      description: 'Обновлённое условие задания',
      dueAt: dueIn(14),
      maxScore: 15,
      allowResubmit: false,
    },
  })
  check(updatedHomework.status === 200, 'PATCH /teacher/homework/:id обновляет задание', updatedHomework.data)
  check(updatedHomework.data?.title?.includes('обновлено'), 'новое название сохранено')
  check(updatedHomework.data?.maxScore === 15, 'новый максимальный балл сохранён')
  check(updatedHomework.data?.allowResubmit === false, 'повторная сдача отключена')

  const partialHomework = await request(`/teacher/homework/${homeworkId}`, {
    method: 'PATCH',
    token: teacherToken,
    body: { description: 'Обновлено только описание' },
  })
  check(
    partialHomework.status === 200 && partialHomework.data?.maxScore === 15 && partialHomework.data?.allowResubmit === false,
    'частичное обновление не сбрасывает балл и режим сдачи',
    partialHomework.data,
  )

  const afterHomework = await request(`/teacher/courses/${course.id}`, { token: teacherToken })
  const listedHomework = (afterHomework.data?.homework ?? []).find((item) => item.id === homeworkId)
  check(Boolean(listedHomework), 'задание видно в программе курса')
  check(listedHomework?.lesson === null, 'задание без привязки к уроку')

  const invalidHomework = await request(`/teacher/courses/${course.id}/homework`, {
    method: 'POST',
    token: teacherToken,
    body: {
      title: homeworkMarker,
      description: 'Некорректный дедлайн',
      dueAt: 'не-дата',
      maxScore: 10,
      allowResubmit: false,
    },
  })
  check(invalidHomework.status === 422, 'некорректный дедлайн отклоняется с 422', invalidHomework.data)

  const zeroScore = await request(`/teacher/homework/${homeworkId}`, {
    method: 'PATCH',
    token: teacherToken,
    body: { maxScore: 0 },
  })
  check(zeroScore.status === 422, 'нулевой максимальный балл отклоняется с 422', zeroScore.data)

  const studentHomework = await request(`/teacher/courses/${course.id}/homework`, {
    method: 'POST',
    token: studentToken,
    body: {
      title: 'Задание от ученика',
      description: 'Такого быть не должно',
      dueAt: dueIn(3),
      maxScore: 10,
      allowResubmit: false,
    },
  })
  check(studentHomework.status === 403, 'ученик не может создавать задания', studentHomework.data)

  // Ученик: подготовить работу, если в базе ещё нет отправленных решений.
  const homework = await request('/homework', { token: studentToken })
  const assignment = (homework.data?.items ?? []).find((item) => item.course?.id === course.id) ?? homework.data?.items?.[0]
  check(Boolean(assignment?.id), 'у ученика есть задание курса')

  let all = await request('/teacher/submissions?status=ALL&limit=100', { token: teacherToken })
  check(all.status === 200 && Array.isArray(all.data?.items), 'GET /teacher/submissions отдаёт очередь')

  let submission = (all.data?.items ?? []).find((item) => item.homework?.id === assignment?.id) ?? all.data?.items?.[0]

  if (!submission) {
    const submitted = await request(`/homework/${assignment.id}/submit`, {
      method: 'POST',
      token: studentToken,
      body: {
        text: 'Решение из автоматической проверки кабинета преподавателя',
        idempotencyKey: `verify-teacher-${randomUUID()}`,
      },
    })
    check([201, 200].includes(submitted.status), 'ученик отправил решение на проверку', submitted.data)

    const pending = await request('/teacher/submissions?status=PENDING&limit=50', { token: teacherToken })
    submission = (pending.data?.items ?? []).find((item) => item.homework?.id === assignment?.id) ?? pending.data?.items?.[0]
    check(Boolean(submission?.id), 'работа попала в очередь проверки', pending.data?.items?.length)
  }

  check(Boolean(submission?.id), 'есть работа для проверки')
  check(submission?.student?.name?.length > 0, 'в работе указан ученик')

  const submissionDetail = await request(`/teacher/submissions/${submission.id}`, { token: teacherToken })
  check(submissionDetail.status === 200 && submissionDetail.data?.homework?.maxScore > 0, 'GET /teacher/submissions/:id отдаёт работу')

  const reviewed = await request(`/teacher/submissions/${submission.id}/review`, {
    method: 'POST',
    token: teacherToken,
    body: { score: 8, comment: 'Хорошая работа, поправьте оформление.' },
  })
  check(reviewed.status === 201 && reviewed.data?.status === 'REVIEWED', 'POST /teacher/submissions/:id/review ставит оценку', reviewed.data)

  const afterReview = await request(`/teacher/submissions/${submission.id}`, { token: teacherToken })
  check(afterReview.data?.score === 8, 'балл сохранён в работе')
  check(afterReview.data?.review?.comment?.includes('Хорошая работа'), 'комментарий сохранён в отзыве')

  const lowerMaxScore = await request(`/teacher/homework/${submission.homework.id}`, {
    method: 'PATCH',
    token: teacherToken,
    body: { maxScore: 5 },
  })
  check(lowerMaxScore.status === 400, 'нельзя опустить максимум ниже выставленного балла', lowerMaxScore.data)

  const notifications = await request('/notifications', { token: studentToken })
  const gotGrade = (notifications.data?.items ?? []).some((item) => item.type === 'GRADE_RECEIVED')
  check(gotGrade, 'ученик получил уведомление об оценке')

  const returned = await request(`/teacher/submissions/${submission.id}/review`, {
    method: 'POST',
    token: teacherToken,
    body: { score: 5, comment: 'Доработайте решение.', returnForRevision: true },
  })
  check(returned.data?.status === 'RETURNED', 'повторная проверка возвращает работу на доработку')

  const aboveMax = await request(`/teacher/submissions/${submission.id}/review`, {
    method: 'POST',
    token: teacherToken,
    body: { score: 99 },
  })
  check(aboveMax.status === 400, 'балл выше максимума задания отклоняется с 400', aboveMax.data)

  const invalid = await request(`/teacher/submissions/${submission.id}/review`, {
    method: 'POST',
    token: teacherToken,
    body: { score: 999 },
  })
  check(invalid.status === 422, 'некорректный балл отклоняется с 422', invalid.data)

  const forbidden = await request('/teacher/overview', { token: studentToken })
  check(forbidden.status === 403, 'ученику закрыт доступ к кабинету преподавателя', forbidden.data)

  const anonymous = await request('/teacher/courses')
  check(anonymous.status === 401, 'без токена кабинет недоступен')

  console.log(`\nИтого: ${passed} успешно, ${failed} с ошибкой`)
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error('\nПроверка прервана:', error)
  process.exitCode = 1
})
