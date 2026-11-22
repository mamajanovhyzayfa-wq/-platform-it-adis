/**
 * Сквозная проверка расписания, домашних заданий, тестов и IT Coins.
 *
 * Запуск: node scripts/verify-learning-flow-api.mjs (сервер должен быть запущен).
 *
 * Сценарий проверяет:
 *  - создание занятия и конфликт по времени (409), видимость у ученика и запрет для ученика;
 *  - отправку решения с текстом, ссылкой и файлом, идемпотентность и запрет второй попытки;
 *  - оценку с начислением монет, отсутствие повторного начисления и возврат на доработку;
 *  - повторную сдачу после возврата при отключённой повторной сдаче;
 *  - тест с вопросом SINGLE: баллы и монеты считает сервер, ключи ответов не утекают;
 *  - историю IT Coins с источником начисления.
 */
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

const API = process.env.API_URL ?? 'http://localhost:4000/api'
const PASSWORD = 'ITadis2026'
const prisma = new PrismaClient()

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
    body: { identifier, password: PASSWORD, deviceId: `verify-learning-${randomUUID()}` },
  })
  if (result.status !== 200) throw new Error(`Не удалось войти как ${identifier}: ${JSON.stringify(result.data)}`)
  return { token: result.data.tokens.accessToken, id: result.data.user.id }
}

async function main() {
  console.log('Проверка расписания, заданий, тестов и IT Coins\n')

  const teacher = await login('teacher@itadis.kg')
  const student = await login('student@itadis.kg')

  const courses = await request('/teacher/courses', { token: teacher.token })
  const course = courses.data?.items?.[0]
  check(Boolean(course?.id), 'у преподавателя есть курс для проверки')
  if (!course?.id) throw new Error('Нет курса')

  // Ученик должен быть записан: иначе расписание и задания ему не видны.
  await prisma.courseEnrollment.upsert({
    where: { courseId_studentId: { courseId: course.id, studentId: student.id } },
    create: { courseId: course.id, studentId: student.id, status: 'ACTIVE' },
    update: {},
  })

  // --- Расписание -------------------------------------------------------
  const start = new Date()
  start.setDate(start.getDate() + 20 + Math.floor(Math.random() * 200))
  start.setHours(3 + Math.floor(Math.random() * 16), 7, 0, 0)
  const scheduleTitle = `Проверка занятия ${Date.now()}`

  const created = await request('/schedule', {
    method: 'POST',
    token: teacher.token,
    body: {
      courseId: course.id,
      title: scheduleTitle,
      description: 'Создано автоматической проверкой',
      startsAt: start.toISOString(),
      durationMinutes: 60,
    },
  })
  check(created.status === 201 && Boolean(created.data?.id), 'POST /schedule создаёт занятие', created.data)
  check(
    created.data?.endsAt && new Date(created.data.endsAt).getTime() - new Date(created.data.startsAt).getTime() === 3600000,
    'конец занятия рассчитан по длительности',
    created.data,
  )
  const scheduleId = created.data?.id

  const conflicting = await request('/schedule', {
    method: 'POST',
    token: teacher.token,
    body: {
      courseId: course.id,
      title: 'Пересекающееся занятие',
      startsAt: new Date(start.getTime() + 15 * 60_000).toISOString(),
      durationMinutes: 45,
    },
  })
  check(conflicting.status === 409, 'пересечение по времени отклоняется с 409', conflicting.data)

  const studentCreate = await request('/schedule', {
    method: 'POST',
    token: student.token,
    body: { courseId: course.id, title: 'Занятие ученика', startsAt: start.toISOString(), durationMinutes: 60 },
  })
  check(studentCreate.status === 403, 'ученик не может создавать занятия', studentCreate.data)

  const shortSchedule = await request('/schedule', {
    method: 'POST',
    token: teacher.token,
    body: {
      courseId: course.id,
      title: 'Слишком короткое занятие',
      startsAt: new Date(start.getTime() + 86_400_000).toISOString(),
      durationMinutes: 5,
    },
  })
  check(shortSchedule.status === 422, 'слишком короткое занятие отклоняется с 422', shortSchedule.data)

  const studentSchedule = await request(
    `/schedule?from=${new Date(start.getTime() - 3_600_000).toISOString()}&to=${new Date(start.getTime() + 3_600_000).toISOString()}`,
    { token: student.token },
  )
  check(
    studentSchedule.status === 200 && (studentSchedule.data?.items ?? []).some((item) => item.id === scheduleId),
    'ученик видит занятие своего курса в периоде',
    studentSchedule.data,
  )

  const teacherSchedule = await request(
    `/schedule?from=${new Date(start.getTime() - 3_600_000).toISOString()}&to=${new Date(start.getTime() + 3_600_000).toISOString()}`,
    { token: teacher.token },
  )
  check(
    teacherSchedule.status === 200 && (teacherSchedule.data?.items ?? []).some((item) => item.id === scheduleId),
    'преподаватель видит своё занятие',
    teacherSchedule.status,
  )

  const defaultRange = await request('/schedule', { token: teacher.token })
  check(defaultRange.status === 200 && Array.isArray(defaultRange.data?.items), 'GET /schedule без периода отдаёт окно по умолчанию')

  const invalidRange = await request(
    `/schedule?from=${new Date(start.getTime() + 3_600_000).toISOString()}&to=${new Date(start.getTime()).toISOString()}`,
    { token: student.token },
  )
  check(invalidRange.status === 400, 'обратный период отклоняется с 400', invalidRange.data)

  // --- Домашнее задание -------------------------------------------------
  const homeworkTitle = `Автопроверка ДЗ ${Date.now()}`
  const homework = await request(`/teacher/courses/${course.id}/homework`, {
    method: 'POST',
    token: teacher.token,
    body: {
      title: homeworkTitle,
      description: 'Решение с текстом, ссылкой и файлом',
      dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      maxScore: 20,
      allowResubmit: false,
    },
  })
  check(homework.status === 201 && Boolean(homework.data?.id), 'преподаватель создал задание', homework.data)
  const homeworkId = homework.data?.id

  const idempotencyKey = `verify-learning-${randomUUID()}`
  const submitBody = {
    text: 'Решение из сквозной проверки',
    projectUrl: 'https://example.com/project',
    files: [{ name: 'archive.zip', url: 'https://example.com/archive.zip' }],
    idempotencyKey,
  }
  const submitted = await request(`/homework/${homeworkId}/submit`, {
    method: 'POST',
    token: student.token,
    body: submitBody,
  })
  check(submitted.status === 201 && submitted.data?.attempt === 1, 'ученик отправил текст, ссылку и файл', submitted.data)
  const submissionId = submitted.data?.id

  const repeated = await request(`/homework/${homeworkId}/submit`, {
    method: 'POST',
    token: student.token,
    body: submitBody,
  })
  check(repeated.status === 200 && repeated.data?.repeated === true, 'повтор с тем же ключом не создаёт работу', repeated.data)

  const secondAttemptBlocked = await request(`/homework/${homeworkId}/submit`, {
    method: 'POST',
    token: student.token,
    body: { ...submitBody, idempotencyKey: `verify-learning-${randomUUID()}` },
  })
  check(secondAttemptBlocked.status === 400, 'вторая попытка без повторной сдачи отклоняется', secondAttemptBlocked.data)

  const emptySubmission = await request(`/homework/${homeworkId}/submit`, {
    method: 'POST',
    token: student.token,
    body: { idempotencyKey: `verify-learning-${randomUUID()}` },
  })
  check(emptySubmission.status === 422, 'пустое решение отклоняется с 422', emptySubmission.data)

  const detail = await request(`/homework/${homeworkId}`, { token: student.token })
  check(detail.status === 200 && detail.data?.mySubmission?.files?.length === 1, 'ученик видит отправленные файлы', detail.data?.mySubmission)

  const reviewed = await request(`/teacher/submissions/${submissionId}/review`, {
    method: 'POST',
    token: teacher.token,
    body: { score: 16, comment: 'Хорошая работа' },
  })
  check(reviewed.status === 201 && reviewed.data?.status === 'REVIEWED', 'преподаватель поставил оценку', reviewed.data)

  // Награда фиксированная: 10 за проверенную работу + 5 за результат 70–89%.
  // 16 из 20 — это 80%, поэтому ожидаем 15 монет. sourceId — задание, чтобы
  // повторная проверка и доработка не начисляли награду второй раз.
  const coinsAfterHomework = await request('/coins/history?limit=50', { token: student.token })
  const homeworkCoin = (coinsAfterHomework.data?.items ?? []).find(
    (item) => item.sourceType === 'HOMEWORK' && item.sourceId === homeworkId,
  )
  check(homeworkCoin?.amount === 15, 'за ДЗ начислены монеты по правилам филиала', homeworkCoin ?? coinsAfterHomework.data?.items?.slice(0, 3))
  check(Boolean(homeworkCoin), 'начисление видно в истории с источником HOMEWORK', coinsAfterHomework.data?.items?.slice(0, 3))
  check(coinsAfterHomework.data?.balance >= 15, 'баланс увеличен', coinsAfterHomework.data?.balance)

  const rereeview = await request(`/teacher/submissions/${submissionId}/review`, {
    method: 'POST',
    token: teacher.token,
    body: { score: 18, comment: 'Повторная проверка' },
  })
  check(rereeview.status < 300 && rereeview.data?.status === 'REVIEWED', 'повторная проверка сохраняет оценку', rereeview.data)

  const coinsAfterSecondReview = await request('/coins/history?limit=50', { token: student.token })
  const homeworkCoinCount = (coinsAfterSecondReview.data?.items ?? []).filter(
    (item) => item.sourceType === 'HOMEWORK' && item.sourceId === homeworkId,
  ).length
  check(homeworkCoinCount === 1, 'повторная проверка не начисляет монеты дважды', homeworkCoinCount)

  const returned = await request(`/teacher/submissions/${submissionId}/review`, {
    method: 'POST',
    token: teacher.token,
    body: { score: 10, comment: 'Доработайте', returnForRevision: true },
  })
  check(returned.data?.status === 'RETURNED', 'работа возвращена на доработку', returned.data?.status)

  const resubmitted = await request(`/homework/${homeworkId}/submit`, {
    method: 'POST',
    token: student.token,
    body: { text: 'Доработанное решение', idempotencyKey: `verify-learning-${randomUUID()}` },
  })
  check(
    resubmitted.status === 201 && resubmitted.data?.attempt === 2,
    'после возврата ученик сдаёт снова при выключенной повторной сдаче',
    resubmitted.data,
  )

  // --- Тест: баллы и монеты --------------------------------------------
  const testTitle = `Автопроверка теста ${Date.now()}`
  const test = await prisma.test.create({
    data: {
      courseId: course.id,
      title: testTitle,
      description: 'Создан сквозной проверкой',
      timeLimitMinutes: 10,
      passingScore: 50,
      attemptsAllowed: 1,
      isPublished: true,
      questions: {
        create: [
          {
            type: 'SINGLE',
            prompt: 'Выберите правильный вариант',
            points: 5,
            position: 1,
            options: {
              create: [
                { text: 'Правильный', isCorrect: true, position: 0 },
                { text: 'Неправильный', isCorrect: false, position: 1 },
              ],
            },
          },
        ],
      },
    },
    include: { questions: { include: { options: true } } },
  })

  try {
    const question = test.questions[0]
    const correctOption = question.options.find((option) => option.isCorrect)
    if (!question || !correctOption) throw new Error('Тест создан без корректного вопроса')

    const testDetail = await request(`/tests/${test.id}`, { token: student.token })
    check(testDetail.status === 200, 'GET /tests/:id отдаёт тест ученику', testDetail.data)
    check(!JSON.stringify(testDetail.data).includes('isCorrect'), 'ключи правильных ответов не утекают в клиент')
    check(testDetail.data?.attemptsLeft === 1, 'ученику доступна одна попытка')

    const started = await request(`/tests/${test.id}/start`, { method: 'POST', token: student.token })
    check(started.status === 201 && started.data?.attemptId, 'POST /tests/:id/start создаёт попытку', started.data)
    const attemptId = started.data?.attemptId

    const finished = await request(`/tests/${test.id}/submit`, {
      method: 'POST',
      token: student.token,
      body: { attemptId, answers: [{ questionId: question.id, value: correctOption.id }] },
    })
    check(finished.status === 200 && finished.data?.percent === 100 && finished.data?.passed === true, 'сервер посчитал 100% и сдачу', finished.data)

    const coinsAfterTest = await request('/coins/history?limit=50', { token: student.token })
    const testCoin = (coinsAfterTest.data?.items ?? []).find(
      (item) => item.sourceType === 'TEST' && item.sourceId === test.id,
    )
    check(testCoin?.amount === 20, 'за пройденный тест начислено 20 монет', testCoin ?? coinsAfterTest.data?.items?.slice(0, 3))
    check(Boolean(testCoin), 'начисление за тест видно в истории', coinsAfterTest.data?.items?.slice(0, 3))

    // Убираем тестовый тест и его движение монет, чтобы демо-данные не копились.
    await prisma.$transaction(async (tx) => {
      await tx.test.delete({ where: { id: test.id } })
      if (testCoin) {
        await tx.coinTransaction.deleteMany({ where: { userId: student.id, sourceType: 'TEST', sourceId: test.id } })
        await tx.coinBalance.update({ where: { userId: student.id }, data: { balance: { decrement: testCoin.amount } } })
      }
    })
  } catch (error) {
    await prisma.test.delete({ where: { id: test.id } }).catch(() => null)
    throw error
  }

  console.log(`\nИтого: ${passed} успешно, ${failed} с ошибкой`)
  if (failed > 0) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error('\nПроверка прервана:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
