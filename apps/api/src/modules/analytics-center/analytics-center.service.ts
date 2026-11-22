import { Inject, Injectable } from '@nestjs/common'
import type { RoleName } from '@prisma/client'
import { badRequest, forbidden } from '../../lib/errors.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import { FinanceService } from '../finance/finance.service.js'
import type { OverviewQuery } from '../finance/finance.schemas.js'

const DAY_MS = 24 * 60 * 60 * 1000

interface Range { from: Date; to: Date }

interface MonthBucket {
  key: string
  label: string
  attendance: number
  present: number
  scoreSum: number
  scoreCount: number
  applications: number
}

function parseRange(query: OverviewQuery): Range {
  const to = query.to ? new Date(query.to) : new Date()
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - 90 * DAY_MS)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
    throw badRequest('Проверьте период аналитики')
  }
  return { from, to }
}

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0
}

function average(values: number[]): number {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString('ru-RU', { month: 'short' })
}

function monthsBetween(from: Date, to: Date): Array<{ key: string; label: string; start: Date }> {
  const result: Array<{ key: string; label: string; start: Date }> = []
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1))
  while (cursor <= to && result.length < 12) {
    const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`
    result.push({ key, label: monthLabel(cursor), start: new Date(cursor) })
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return result
}

function bucketFor(buckets: MonthBucket[], date: Date): MonthBucket | undefined {
  const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
  return buckets.find((bucket) => bucket.key === key)
}

function linearForecast(values: Array<number | null | undefined>): number | null {
  // Пропуски месяцев (null) нельзя превращать в 0: иначе прогноз падает
  // из-за месяцев без занятий или без оценок. Позиции сохраняем, чтобы
  // пропущенный месяц не сдвигал тренд.
  const points: Array<{ x: number; y: number }> = []
  values.forEach((value, index) => {
    if (typeof value === 'number' && Number.isFinite(value)) points.push({ x: index, y: value })
  })
  if (points.length === 0) return null
  if (points.length === 1) return Math.max(0, Math.min(100, Math.round(points[0]?.y ?? 0)))
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length
  let numerator = 0
  let denominator = 0
  for (const point of points) {
    numerator += (point.x - meanX) * (point.y - meanY)
    denominator += (point.x - meanX) ** 2
  }
  const slope = denominator === 0 ? 0 : numerator / denominator
  return Math.max(0, Math.min(100, Math.round(meanY + slope * (values.length - meanX))))
}

function delta(current: number, previous: number): number {
  return previous === 0 ? (current > 0 ? 100 : 0) : Math.round(((current - previous) / previous) * 100)
}

/** Аналитический центр: единый контракт для всех ролей, данные фильтруются по роли. */
@Injectable()
export class AnalyticsCenterService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FinanceService) private readonly finance: FinanceService,
  ) {}

  async overview(user: { userId: string; role: RoleName }, query: OverviewQuery) {
    const range = parseRange(query)
    const previous: Range = {
      from: new Date(range.from.getTime() - (range.to.getTime() - range.from.getTime())),
      to: range.from,
    }
    if (user.role === 'STUDENT') return this.student(user.userId, range, previous)
    if (user.role === 'TEACHER') return this.teacher(user.userId, range, previous)
    if (user.role === 'MANAGER') return this.manager(range, previous)
    if (user.role === 'ADMIN') return this.admin(range, previous)
    throw forbidden('Аналитика доступна ученику, наставнику, менеджеру или администратору')
  }

  // ------------------------------------------------------------------ ученик

  private async student(userId: string, range: Range, previous: Range) {
    const [current, before, profile] = await Promise.all([
      this.studentSnapshot(userId, range),
      this.studentSnapshot(userId, previous),
      this.prisma.client.student.findUnique({
        where: { userId },
        select: { gradeLevel: true, schoolName: true, user: { select: { firstName: true, lastName: true, email: true } } },
      }),
    ])

    const rankedCourses = current.courses
      .filter((course) => course.average !== null)
      .sort((a, b) => (b.average ?? 0) - (a.average ?? 0))
    const strong = rankedCourses[0] ?? null
    const weak = rankedCourses[rankedCourses.length - 1] ?? null
    const strongCourses = rankedCourses.filter((course) => (course.average ?? 0) >= 70).slice(0, 3)
    const weakCourses = [...rankedCourses].reverse().filter((course) => (course.average ?? 0) < 70).slice(0, 3)
    const recommendations: string[] = []
    if (current.attendance.total >= 2 && current.attendanceRate < 80) recommendations.push('Посещаемость ниже 80%: обсудите с наставником пропущенные темы и восстановите график занятий.')
    if (current.assignmentsDue > 0 && current.assignmentCompletion < 70) recommendations.push('Выполнено меньше 70% заданий: начните с ближайших дедлайнов и разберите сложные темы с наставником.')
    if (weak && (weak.average ?? 0) < 65) recommendations.push(`Слабая тема — «${weak.course}»: запросите дополнительную практику и разбор ошибок.`)
    if (strong && (strong.average ?? 0) >= 70) recommendations.push(`Сильная сторона — «${strong.course}»: используйте её для уверенности и помощи другим ученикам.`)
    if (recommendations.length === 0) recommendations.push('Динамика стабильная: сохраняйте текущий темп и продолжайте выполнять задания вовремя.')

    return {
      role: 'STUDENT',
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      profile: profile ? { name: `${profile.user.firstName} ${profile.user.lastName}`.trim(), email: profile.user.email, gradeLevel: profile.gradeLevel, schoolName: profile.schoolName } : null,
      metrics: {
        progress: current.progress,
        averageScore: current.averageScore,
        attendanceRate: current.attendanceRate,
        assignmentCompletion: current.assignmentCompletion,
        achievements: current.achievements.length,
      },
      comparison: {
        previousRange: { from: previous.from.toISOString(), to: previous.to.toISOString() },
        averageScore: { current: current.averageScore, previous: before.averageScore, delta: delta(current.averageScore, before.averageScore) },
        attendanceRate: { current: current.attendanceRate, previous: before.attendanceRate, delta: delta(current.attendanceRate, before.attendanceRate) },
        assignmentCompletion: { current: current.assignmentCompletion, previous: before.assignmentCompletion, delta: delta(current.assignmentCompletion, before.assignmentCompletion) },
        progress: { current: current.progress, previous: before.progress, delta: delta(current.progress, before.progress) },
      },
      trend: current.trend,
      courses: current.courses,
      attendance: current.attendance,
      assignments: current.assignments,
      achievements: current.achievements,
      strengths: strongCourses.map((course) => course.course),
      weaknesses: weakCourses.map((course) => course.course),
      recommendations,
      forecast: {
        nextScore: current.forecastScore,
        nextAttendance: current.forecastAttendance,
        confidence: current.records >= 5 ? 'medium' : 'low',
        note: 'Прогноз построен по линейному тренду текущего периода и не является гарантией результата.',
      },
      needsSupport: current.supportReasons.length > 0,
      supportReasons: current.supportReasons,
    }
  }

  private async studentSnapshot(userId: string, range: Range) {
    const enrollments = await this.prisma.client.courseEnrollment.findMany({
      where: { studentId: userId, status: { in: ['ACTIVE', 'COMPLETED', 'PAUSED'] } },
      select: { progress: true, status: true, courseId: true, course: { select: { id: true, title: true } } },
    })
    const [attendance, submissions, attempts, homeworks, achievements] = await Promise.all([
      this.prisma.client.attendance.findMany({
        where: { userId, schedule: { startsAt: { gte: range.from, lte: range.to } } },
        select: { status: true, schedule: { select: { startsAt: true, title: true, course: { select: { id: true, title: true } } } } },
      }),
      this.prisma.client.homeworkSubmission.findMany({
        where: { studentId: userId, submittedAt: { gte: range.from, lte: range.to } },
        select: { score: true, status: true, submittedAt: true, homework: { select: { maxScore: true, title: true, course: { select: { id: true, title: true } } } } },
      }),
      this.prisma.client.testAttempt.findMany({
        where: { studentId: userId, submittedAt: { gte: range.from, lte: range.to }, percent: { not: null } },
        select: { percent: true, submittedAt: true, test: { select: { title: true, course: { select: { id: true, title: true } } } } },
      }),
      this.prisma.client.homework.count({
        where: { courseId: { in: enrollments.map((enrollment) => enrollment.courseId) }, dueAt: { gte: range.from, lte: range.to } },
      }),
      this.prisma.client.userAchievement.findMany({
        where: { userId },
        select: { awardedAt: true, achievement: { select: { title: true, description: true, iconUrl: true } } },
        orderBy: { awardedAt: 'desc' },
        take: 12,
      }),
    ])

    const buckets: MonthBucket[] = monthsBetween(range.from, range.to).map(({ key, label }) => ({ key, label, attendance: 0, present: 0, scoreSum: 0, scoreCount: 0, applications: 0 }))
    for (const record of attendance) {
      const bucket = bucketFor(buckets, record.schedule.startsAt)
      if (!bucket) continue
      bucket.attendance += 1
      if (record.status !== 'ABSENT') bucket.present += 1
    }
    for (const submission of submissions) {
      if (submission.score === null) continue
      const bucket = bucketFor(buckets, submission.submittedAt)
      if (!bucket) continue
      bucket.scoreSum += percent(submission.score, submission.homework.maxScore)
      bucket.scoreCount += 1
    }
    const trend = buckets.map((bucket) => ({
      label: bucket.label,
      attendanceRate: bucket.attendance ? percent(bucket.present, bucket.attendance) : null,
      averageScore: bucket.scoreCount ? Math.round(bucket.scoreSum / bucket.scoreCount) : null,
    }))

    const scores: number[] = []
    for (const submission of submissions) if (submission.score !== null) scores.push(percent(submission.score, submission.homework.maxScore))
    for (const attempt of attempts) if (attempt.percent !== null) scores.push(attempt.percent)
    const attendanceRate = percent(attendance.filter((record) => record.status !== 'ABSENT').length, attendance.length)
    const averageScore = average(scores)
    const progress = average(enrollments.map((enrollment) => enrollment.progress))

    const byCourse = new Map<string, { course: string; scores: number[]; attendance: number[] }>()
    for (const enrollment of enrollments) byCourse.set(enrollment.courseId, { course: enrollment.course.title, scores: [], attendance: [] })
    for (const submission of submissions) {
      if (submission.score === null) continue
      const row = byCourse.get(submission.homework.course.id)
      if (row) row.scores.push(percent(submission.score, submission.homework.maxScore))
    }
    for (const attempt of attempts) {
      if (attempt.percent === null) continue
      const row = byCourse.get(attempt.test.course.id)
      if (row) row.scores.push(attempt.percent)
    }
    for (const record of attendance) {
      const row = byCourse.get(record.schedule.course.id)
      if (row) row.attendance.push(record.status === 'ABSENT' ? 0 : 100)
    }
    const courses = [...byCourse.values()].map((row) => ({
      course: row.course,
      average: row.scores.length ? average(row.scores) : null,
      attendanceRate: row.attendance.length ? average(row.attendance) : null,
    }))

    const assignments = submissions
      .map((submission) => ({
        title: submission.homework.title,
        course: submission.homework.course.title,
        submittedAt: submission.submittedAt,
        status: submission.status,
        score: submission.score,
        maxScore: submission.homework.maxScore,
        percent: submission.score === null ? null : percent(submission.score, submission.homework.maxScore),
      }))
      .sort((left, right) => right.submittedAt.getTime() - left.submittedAt.getTime())
      .slice(0, 30)

    const assignmentCompletion = percent(submissions.length, homeworks)
    const supportReasons = [
      ...(attendance.length >= 2 && attendanceRate < 75 ? [`Посещаемость ${attendanceRate}%`] : []),
      ...(scores.length > 0 && averageScore < 60 ? [`Средний результат ${averageScore}%`] : []),
      ...(homeworks > 0 && assignmentCompletion < 60 ? [`Задания выполнены на ${assignmentCompletion}%`] : []),
    ]

    return {
      progress,
      averageScore,
      attendanceRate,
      assignmentCompletion,
      assignmentsDue: homeworks,
      supportReasons,
      achievements: achievements.map((row) => ({ title: row.achievement.title, description: row.achievement.description, iconUrl: row.achievement.iconUrl, awardedAt: row.awardedAt })),
      courses,
      attendance: {
        total: attendance.length,
        present: attendance.filter((record) => record.status !== 'ABSENT').length,
        absent: attendance.filter((record) => record.status === 'ABSENT').length,
        late: attendance.filter((record) => record.status === 'LATE').length,
        rate: attendanceRate,
      },
      assignments,
      trend,
      forecastScore: linearForecast(trend.map((point) => point.averageScore)),
      forecastAttendance: linearForecast(trend.map((point) => point.attendanceRate)),
      records: attendance.length + scores.length,
    }
  }

  // --------------------------------------------------------------- наставник

  private async teacher(userId: string, range: Range, previous: Range) {
    const [current, before] = await Promise.all([
      this.teacherSnapshot(userId, range),
      this.teacherSnapshot(userId, previous),
    ])
    return {
      role: 'TEACHER',
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      metrics: {
        students: current.students,
        groups: current.groups,
        lessons: current.lessons,
        hours: current.hours,
        attendanceRate: current.attendanceRate,
        averageScore: current.averageScore,
        assignmentQuality: current.assignmentQuality,
        efficiency: current.efficiency,
      },
      comparison: {
        previousRange: { from: previous.from.toISOString(), to: previous.to.toISOString() },
        attendanceRate: { current: current.attendanceRate, previous: before.attendanceRate, delta: delta(current.attendanceRate, before.attendanceRate) },
        averageScore: { current: current.averageScore, previous: before.averageScore, delta: delta(current.averageScore, before.averageScore) },
        efficiency: { current: current.efficiency, previous: before.efficiency, delta: delta(current.efficiency, before.efficiency) },
      },
      trend: current.trend,
      groups: current.groupsDetail,
      students: current.studentsDetail,
      atRisk: current.atRisk,
      recommendations: [
        ...(current.attendanceRate < 75 ? ['Посещаемость групп ниже 75%: проверьте расписание и свяжитесь с учениками.'] : []),
        ...(current.assignmentQuality < 70 ? ['Качество заданий ниже 70%: добавьте разбор типовых ошибок.'] : []),
        ...(current.atRisk.length ? [`Учеников в зоне риска: ${current.atRisk.length}. Запланируйте точечную поддержку.`] : []),
        ...(current.efficiency >= 80 ? ['Эффективность высокая: сохраняйте текущую методику.'] : []),
      ],
      forecast: {
        nextAverageScore: current.forecastScore,
        nextAttendance: current.forecastAttendance,
        confidence: current.records >= 10 ? 'medium' : 'low',
        note: 'Прогноз по тренду занятий и оценок; учитывайте сезонность и состав групп.',
      },
    }
  }

  private async teacherSnapshot(userId: string, range: Range) {
    const courses = await this.prisma.client.course.findMany({
      where: { teacherId: userId },
      select: {
        id: true, title: true,
        enrollments: { where: { status: 'ACTIVE' }, select: { studentId: true, progress: true } },
        schedule: { where: { startsAt: { gte: range.from, lte: range.to }, status: { not: 'CANCELLED' } }, select: { id: true, startsAt: true, endsAt: true, attendance: { select: { userId: true, status: true } } } },
      },
    })
    const courseIds = courses.map((course) => course.id)
    const [submissions, homeworks] = await Promise.all([
      this.prisma.client.homeworkSubmission.findMany({
        where: { submittedAt: { gte: range.from, lte: range.to }, homework: { courseId: { in: courseIds } } },
        select: { score: true, studentId: true, submittedAt: true, homework: { select: { maxScore: true, courseId: true } } },
      }),
      this.prisma.client.homework.count({ where: { courseId: { in: courseIds }, dueAt: { gte: range.from, lte: range.to } } }),
    ])
    const schedules = courses.flatMap((course) => course.schedule.map((schedule) => ({ ...schedule, courseId: course.id })))
    const attendance = schedules.flatMap((schedule) => schedule.attendance)
    const attendanceRate = percent(attendance.filter((record) => record.status !== 'ABSENT').length, attendance.length)
    const scoresByStudent = new Map<string, number[]>()
    for (const submission of submissions) {
      if (submission.score === null) continue
      const values = scoresByStudent.get(submission.studentId) ?? []
      values.push(percent(submission.score, submission.homework.maxScore))
      scoresByStudent.set(submission.studentId, values)
    }
    const scores = [...scoresByStudent.values()].flat()
    const averageScore = average(scores)
    const assignmentQuality = percent(submissions.filter((submission) => (submission.score ?? 0) >= submission.homework.maxScore * 0.6).length, submissions.length)
    const studentIds = [...new Set(courses.flatMap((course) => course.enrollments.map((enrollment) => enrollment.studentId)))]
    const lessons = schedules.length
    const minutes = schedules.reduce((sum, schedule) => sum + Math.max(0, Math.round((schedule.endsAt.getTime() - schedule.startsAt.getTime()) / 60000)), 0)

    const studentRisk = new Map<string, { total: number; present: number }>()
    for (const record of attendance) {
      const row = studentRisk.get(record.userId) ?? { total: 0, present: 0 }
      row.total += 1
      if (record.status !== 'ABSENT') row.present += 1
      studentRisk.set(record.userId, row)
    }
    const riskReasons = new Map<string, string[]>()
    const addRisk = (studentId: string, reason: string) => {
      const reasons = riskReasons.get(studentId) ?? []
      reasons.push(reason)
      riskReasons.set(studentId, reasons)
    }
    for (const [studentId, row] of studentRisk) {
      const rate = percent(row.present, row.total)
      if (row.total >= 2 && rate < 70) addRisk(studentId, `Посещаемость ${rate}%`)
    }
    for (const [studentId, values] of scoresByStudent) {
      const score = average(values)
      if (values.length >= 2 && score < 60) addRisk(studentId, `Средний результат ${score}%`)
    }
    const studentProfiles = studentIds.length
      ? await this.prisma.client.user.findMany({
          where: { id: { in: studentIds }, deletedAt: null },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : []
    const atRisk = studentProfiles
      .filter((student) => riskReasons.has(student.id))
      .slice(0, 20)
      .map((student) => {
        const attendanceRow = studentRisk.get(student.id)
        const studentScores = scoresByStudent.get(student.id) ?? []
        return {
          userId: student.id,
          name: `${student.firstName} ${student.lastName}`.trim(),
          email: student.email,
          attendanceRate: attendanceRow ? percent(attendanceRow.present, attendanceRow.total) : null,
          averageScore: studentScores.length ? average(studentScores) : null,
          reason: (riskReasons.get(student.id) ?? []).join('; ') || 'Требуется поддержка',
        }
      })
    const studentsDetail = studentProfiles
      .map((student) => {
        const attendanceRow = studentRisk.get(student.id)
        const studentScores = scoresByStudent.get(student.id) ?? []
        return {
          userId: student.id,
          name: `${student.firstName} ${student.lastName}`.trim(),
          email: student.email,
          courses: courses
            .filter((course) => course.enrollments.some((enrollment) => enrollment.studentId === student.id))
            .map((course) => course.title),
          averageScore: studentScores.length ? average(studentScores) : null,
          attendanceRate: attendanceRow ? percent(attendanceRow.present, attendanceRow.total) : null,
        }
      })
      .sort((left, right) => (left.averageScore ?? 101) - (right.averageScore ?? 101))

    const buckets: MonthBucket[] = monthsBetween(range.from, range.to).map(({ key, label }) => ({ key, label, attendance: 0, present: 0, scoreSum: 0, scoreCount: 0, applications: 0 }))
    for (const record of attendance) {
      const schedule = schedules.find((item) => item.attendance.some((entry) => entry === record))
      if (!schedule) continue
      const bucket = bucketFor(buckets, schedule.startsAt)
      if (!bucket) continue
      bucket.attendance += 1
      if (record.status !== 'ABSENT') bucket.present += 1
    }
    for (const submission of submissions) {
      if (submission.score === null) continue
      const bucket = bucketFor(buckets, submission.submittedAt)
      if (!bucket) continue
      bucket.scoreSum += percent(submission.score, submission.homework.maxScore)
      bucket.scoreCount += 1
    }
    const trend = buckets.map((bucket) => ({ label: bucket.label, attendanceRate: bucket.attendance ? percent(bucket.present, bucket.attendance) : null, averageScore: bucket.scoreCount ? Math.round(bucket.scoreSum / bucket.scoreCount) : null }))

    return {
      students: studentIds.length,
      groups: courses.length,
      lessons,
      hours: Math.round((minutes / 60) * 10) / 10,
      attendanceRate,
      averageScore,
      assignmentQuality,
      efficiency: average([attendanceRate, averageScore, assignmentQuality]),
      groupsDetail: courses.map((course) => ({
        id: course.id,
        title: course.title,
        students: course.enrollments.length,
        progress: average(course.enrollments.map((enrollment) => enrollment.progress)),
        lessons: course.schedule.length,
        attendanceRate: percent(course.schedule.flatMap((schedule) => schedule.attendance).filter((record) => record.status !== 'ABSENT').length, course.schedule.flatMap((schedule) => schedule.attendance).length),
      })),
      atRisk,
      studentsDetail,
      trend,
      forecastScore: linearForecast(trend.map((point) => point.averageScore)),
      forecastAttendance: linearForecast(trend.map((point) => point.attendanceRate)),
      records: attendance.length + submissions.length + homeworks,
    }
  }

  // ------------------------------------------------------- менеджер и админ

  private async manager(range: Range, previous: Range) {
    const [current, before] = await Promise.all([this.orgSnapshot(range), this.orgSnapshot(previous)])
    return {
      role: 'MANAGER',
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      metrics: {
        students: current.students,
        groups: current.groups,
        teachers: current.teachers,
        applications: current.applications,
        newApplications: current.newApplications,
        convertedApplications: current.convertedApplications,
        attendanceRate: current.attendanceRate,
        lessons: current.lessons,
        efficiency: current.efficiency,
      },
      comparison: {
        previousRange: { from: previous.from.toISOString(), to: previous.to.toISOString() },
        students: { current: current.students, previous: before.students, delta: delta(current.students, before.students) },
        applications: { current: current.applications, previous: before.applications, delta: delta(current.applications, before.applications) },
        attendanceRate: { current: current.attendanceRate, previous: before.attendanceRate, delta: delta(current.attendanceRate, before.attendanceRate) },
        efficiency: { current: current.efficiency, previous: before.efficiency, delta: delta(current.efficiency, before.efficiency) },
      },
      trend: current.trend,
      groups: current.groupsDetail,
      teachers: current.teachersDetail.map((teacher) => ({
        userId: teacher.userId,
        name: teacher.name,
        email: teacher.email,
        isActive: teacher.isActive,
        lessons: teacher.lessons,
      })),
      applicationsByStatus: current.applicationsByStatus,
      atRisk: current.atRisk,
      recommendations: [
        ...(current.attendanceRate < 75 ? ['Посещаемость филиала ниже 75%: проверьте нагрузку групп и причины пропусков.'] : []),
        ...(current.newApplications > 0 ? [`Новых заявок без ответа: ${current.newApplications}. Назначьте ответственного.`] : []),
        ...(current.efficiency >= 80 ? ['Организационная эффективность высокая: сохраняйте процессы.'] : []),
      ],
      forecast: {
        nextEfficiency: current.forecastEfficiency,
        nextAttendance: current.forecastAttendance,
        confidence: current.records >= 20 ? 'medium' : 'low',
        note: 'Организационный прогноз по тренду занятий и результатов; учитывайте сезонность и набор групп.',
      },
    }
  }

  private async admin(range: Range, previous: Range) {
    const [current, before, finance, previousFinance] = await Promise.all([
      this.orgSnapshot(range),
      this.orgSnapshot(previous),
      this.finance.overview({ from: range.from.toISOString(), to: range.to.toISOString() }),
      this.finance.overview({ from: previous.from.toISOString(), to: previous.to.toISOString() }),
    ])
    return {
      role: 'ADMIN',
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      metrics: {
        students: current.students,
        groups: current.groups,
        teachers: current.teachers,
        applications: current.applications,
        attendanceRate: current.attendanceRate,
        lessons: current.lessons,
        efficiency: current.efficiency,
        incomeKgs: finance.income.net,
        expensesKgs: finance.expenses,
        profitKgs: finance.profit,
        debtKgs: finance.outstanding.total,
        refundsKgs: finance.income.refunds,
        paymentsKgs: finance.income.payments,
        coins: current.coins,
      },
      finance,
      comparison: {
        previousRange: { from: previous.from.toISOString(), to: previous.to.toISOString() },
        income: { current: finance.income.net, previous: previousFinance.income.net, delta: delta(finance.income.net, previousFinance.income.net) },
        attendanceRate: { current: current.attendanceRate, previous: before.attendanceRate, delta: delta(current.attendanceRate, before.attendanceRate) },
        efficiency: { current: current.efficiency, previous: before.efficiency, delta: delta(current.efficiency, before.efficiency) },
      },
      trend: current.trend,
      courses: current.courses,
      groups: current.groupsDetail,
      teachers: current.teachersDetail,
      atRisk: current.atRisk,
      coins: {
        total: current.coins,
        note: 'IT Coins — отдельная внутренняя валюта. Она не входит в доходы, расходы и прибыль.',
      },
      recommendations: [
        ...(current.attendanceRate < 75 ? ['Посещаемость филиала ниже 75%: требуется разбор по группам.'] : []),
        ...(finance.outstanding.total > 0 ? [`Задолженность ${finance.outstanding.total} KGS: назначьте напоминания и сверку счетов.`] : []),
        ...(current.atRisk.length ? [`Учеников в зоне риска: ${current.atRisk.length}.`] : []),
      ],
      forecast: {
        nextEfficiency: current.forecastEfficiency,
        nextAttendance: current.forecastAttendance,
        confidence: current.records >= 20 ? 'medium' : 'low',
        note: 'Организационный прогноз по тренду; финансовый прогноз смотрите в финансовом кабинете.',
      },
    }
  }

  private async orgSnapshot(range: Range) {
    const [students, groups, teachers, applications, schedules, submissions, coins, courses, groupedTeachers] = await Promise.all([
      this.prisma.client.user.count({ where: { role: 'STUDENT', isActive: true, deletedAt: null } }),
      this.prisma.client.course.count({ where: { status: 'ACTIVE' } }),
      this.prisma.client.user.count({ where: { role: 'TEACHER', isActive: true, deletedAt: null } }),
      this.prisma.client.lead.findMany({
        where: { createdAt: { gte: range.from, lte: range.to } },
        select: { status: true, createdAt: true },
      }),
      this.prisma.client.schedule.findMany({
        where: { startsAt: { gte: range.from, lte: range.to }, status: { not: 'CANCELLED' } },
        select: { startsAt: true, endsAt: true, teacherId: true, courseId: true, attendance: { select: { userId: true, status: true } } },
      }),
      this.prisma.client.homeworkSubmission.findMany({
        where: { submittedAt: { gte: range.from, lte: range.to } },
        select: { score: true, studentId: true, submittedAt: true, homework: { select: { maxScore: true } } },
      }),
      this.prisma.client.coinTransaction.aggregate({ where: { status: 'POSTED', createdAt: { gte: range.from, lte: range.to } }, _sum: { amount: true } }),
      this.prisma.client.course.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, title: true, priceKgs: true, enrollments: { where: { status: 'ACTIVE' }, select: { progress: true } } },
      }),
      this.prisma.client.teacher.findMany({
        select: { userId: true, lessonRateKgs: true, user: { select: { firstName: true, lastName: true, email: true, isActive: true } } },
      }),
    ])
    const attendance = schedules.flatMap((schedule) => schedule.attendance)
    const attendanceRate = percent(attendance.filter((record) => record.status !== 'ABSENT').length, attendance.length)
    const applicationsByStatus = ['NEW', 'CONTACTED', 'CONVERTED', 'REJECTED'].map((status) => ({ status, count: applications.filter((application) => application.status === status).length }))
    const absences = new Map<string, { total: number; absent: number }>()
    for (const record of attendance) {
      const row = absences.get(record.userId) ?? { total: 0, absent: 0 }
      row.total += 1
      if (record.status === 'ABSENT') row.absent += 1
      absences.set(record.userId, row)
    }
    const scoresByStudent = new Map<string, number[]>()
    for (const submission of submissions) {
      if (submission.score === null) continue
      const values = scoresByStudent.get(submission.studentId) ?? []
      values.push(percent(submission.score, submission.homework.maxScore))
      scoresByStudent.set(submission.studentId, values)
    }
    const riskReasons = new Map<string, string[]>()
    const addRisk = (studentId: string, reason: string) => {
      const reasons = riskReasons.get(studentId) ?? []
      reasons.push(reason)
      riskReasons.set(studentId, reasons)
    }
    for (const [studentId, row] of absences) {
      const rate = percent(row.absent, row.total)
      if (row.total >= 3 && rate >= 30) addRisk(studentId, `Пропуски ${rate}%`)
    }
    for (const [studentId, values] of scoresByStudent) {
      const score = average(values)
      if (values.length >= 2 && score < 60) addRisk(studentId, `Средний результат ${score}%`)
    }
    const riskIds = [...riskReasons.keys()].slice(0, 20)
    const riskUsers = riskIds.length
      ? await this.prisma.client.user.findMany({ where: { id: { in: riskIds } }, select: { id: true, firstName: true, lastName: true, email: true } })
      : []
    const atRisk = riskUsers.map((student) => {
      const row = absences.get(student.id)
      const values = scoresByStudent.get(student.id) ?? []
      return {
        userId: student.id,
        name: `${student.firstName} ${student.lastName}`.trim(),
        email: student.email,
        absenceRate: row ? percent(row.absent, row.total) : 0,
        averageScore: values.length ? average(values) : null,
        reason: (riskReasons.get(student.id) ?? []).join('; ') || 'Требуется поддержка',
      }
    })

    const buckets: MonthBucket[] = monthsBetween(range.from, range.to).map(({ key, label }) => ({ key, label, attendance: 0, present: 0, scoreSum: 0, scoreCount: 0, applications: 0 }))
    for (const schedule of schedules) {
      const bucket = bucketFor(buckets, schedule.startsAt)
      if (!bucket) continue
      bucket.attendance += schedule.attendance.length
      bucket.present += schedule.attendance.filter((record) => record.status !== 'ABSENT').length
    }
    for (const submission of submissions) {
      if (submission.score === null) continue
      const bucket = bucketFor(buckets, submission.submittedAt)
      if (!bucket) continue
      bucket.scoreSum += percent(submission.score, submission.homework.maxScore)
      bucket.scoreCount += 1
    }
    for (const application of applications) {
      const bucket = bucketFor(buckets, application.createdAt)
      if (bucket) bucket.applications += 1
    }
    const trend = buckets.map((bucket) => ({ label: bucket.label, attendanceRate: bucket.attendance ? percent(bucket.present, bucket.attendance) : null, averageScore: bucket.scoreCount ? Math.round(bucket.scoreSum / bucket.scoreCount) : null, applications: bucket.applications }))

    const minutes = schedules.reduce((sum, schedule) => sum + Math.max(0, Math.round((schedule.endsAt.getTime() - schedule.startsAt.getTime()) / 60000)), 0)
    const averageScore = average(submissions.filter((submission) => submission.score !== null).map((submission) => percent(submission.score as number, submission.homework.maxScore)))
    const efficiencyTrend = trend.map((point) =>
      point.attendanceRate === null || point.averageScore === null ? null : average([point.attendanceRate, point.averageScore]),
    )
    return {
      students, groups, teachers,
      applications: applications.length,
      newApplications: applications.filter((application) => application.status === 'NEW').length,
      convertedApplications: applications.filter((application) => application.status === 'CONVERTED').length,
      applicationsByStatus,
      attendanceRate,
      lessons: schedules.length,
      hours: Math.round((minutes / 60) * 10) / 10,
      averageScore,
      efficiency: average([attendanceRate, averageScore, percent(applications.filter((application) => application.status === 'CONVERTED').length, applications.length)]),
      atRisk,
      coins: coins._sum.amount ?? 0,
      courses: courses.map((course) => ({ id: course.id, title: course.title, priceKgs: course.priceKgs, students: course.enrollments.length, progress: average(course.enrollments.map((enrollment) => enrollment.progress)) })),
      groupsDetail: courses.map((course) => {
        const courseAttendance = schedules.filter((schedule) => schedule.courseId === course.id).flatMap((schedule) => schedule.attendance)
        return {
          id: course.id,
          title: course.title,
          students: course.enrollments.length,
          progress: average(course.enrollments.map((enrollment) => enrollment.progress)),
          attendanceRate: percent(courseAttendance.filter((record) => record.status !== 'ABSENT').length, courseAttendance.length),
        }
      }),
      teachersDetail: groupedTeachers.map((teacher) => ({
        userId: teacher.userId,
        name: `${teacher.user.firstName} ${teacher.user.lastName}`.trim(),
        email: teacher.user.email,
        isActive: teacher.user.isActive,
        lessonRateKgs: teacher.lessonRateKgs,
        lessons: schedules.filter((schedule) => schedule.teacherId === teacher.userId).length,
      })),
      trend,
      forecastEfficiency: linearForecast(efficiencyTrend),
      forecastAttendance: linearForecast(trend.map((point) => point.attendanceRate)),
      records: attendance.length + submissions.length,
    }
  }
}
