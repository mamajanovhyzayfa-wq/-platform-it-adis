import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { Inject, Injectable } from '@nestjs/common'
import { Prisma, type RoleName } from '@prisma/client'
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js'
import { writeFileAudit } from '../../lib/file-audit.js'
import { getTenant } from '../../lib/tenant.js'
import { writeAudit } from '../../lib/audit.js'
import { notifyUsers } from '../../lib/notify.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import {
  buildCertificateHtml,
  certificateFileMatchesMime,
  certificateNumber,
  createVerificationCode,
  isCertificateFileUrl,
} from './certificates.util.js'
import type { CertificateCandidatesQuery, CertificateIssueInput, CertificateQuery } from './certificates.schemas.js'

const certificateInclude = {
  student: { select: { id: true, firstName: true, lastName: true, email: true } },
  course: { select: { id: true, title: true } },
  issuedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.CertificateInclude

type CertificateRow = Prisma.CertificateGetPayload<{ include: typeof certificateInclude }>

/** Подпись сотрудника: после удаления аккаунта ссылка на него обнуляется. */
function staffName(user: { firstName: string; lastName: string } | null): string {
  return user ? `${user.firstName} ${user.lastName}`.trim() : 'Не указан'
}

function toCertificate(row: CertificateRow) {
  return {
    id: row.id,
    number: row.number,
    verificationCode: row.verificationCode,
    status: row.status,
    grade: row.grade,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    revokeReason: row.revokeReason,
    student: {
      ...row.student,
      name: `${row.student.firstName} ${row.student.lastName}`.trim(),
    },
    course: row.course,
    hasFile: Boolean(row.fileUrl),
    // Клиенту отдаётся рабочая ссылка на API; путь в /uploads остаётся внутренним ключом.
    fileUrl: row.fileUrl ? `/api/certificates/${row.id}/file` : null,
    fileName: row.fileName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    issuedBy: staffName(row.issuedBy),
  }
}

/** Ссылка на публичную проверку живёт в админ-панели, а не в мобильном APP_ORIGIN. */
function adminWebOrigin(): string {
  const origin = process.env.ADMIN_WEB_ORIGIN ?? process.env.APP_ORIGIN ?? 'http://localhost:3000'
  return origin.replace(/\/+$/, '')
}

@Injectable()
export class CertificatesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: CertificateQuery) {
    const search = query.search?.trim()
    const where: Prisma.CertificateWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: 'insensitive' } },
              { verificationCode: { contains: search.toUpperCase() } },
              { student: { firstName: { contains: search, mode: 'insensitive' } } },
              { student: { lastName: { contains: search, mode: 'insensitive' } } },
              { student: { email: { contains: search, mode: 'insensitive' } } },
              { course: { title: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    }

    const [items, total] = await Promise.all([
      this.prisma.client.certificate.findMany({
        where,
        include: certificateInclude,
        orderBy: { issuedAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.client.certificate.count({ where }),
    ])

    return {
      items: items.map(toCertificate),
      total,
      page: query.page,
      limit: query.limit,
      pages: Math.max(1, Math.ceil(total / query.limit)),
    }
  }

  /**
   * Ученики и курсы, по которым сертификат ещё не выдан. Форма выдачи показывает
   * только доступные пары, поэтому администратор не упирается в отказ сервера.
   */
  async candidates(query: CertificateCandidatesQuery) {
    const search = query.search?.trim()
    const students = await this.prisma.client.user.findMany({
      where: {
        role: 'STUDENT',
        deletedAt: null,
        enrollments: { some: {} },
        ...(search
          ? {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        enrollments: { select: { course: { select: { id: true, title: true } } } },
        certificates: { select: { courseId: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: query.limit,
    })

    const items = students
      .map((student) => {
        const issued = new Set(student.certificates.map((certificate) => certificate.courseId))
        return {
          id: student.id,
          name: `${student.firstName} ${student.lastName}`.trim(),
          email: student.email,
          courses: student.enrollments
            .map((enrollment) => enrollment.course)
            .filter((course) => !issued.has(course.id)),
        }
      })
      .filter((student) => student.courses.length > 0)

    return { items }
  }

  async my(userId: string) {
    const items = await this.prisma.client.certificate.findMany({
      where: { studentId: userId },
      include: certificateInclude,
      orderBy: { issuedAt: 'desc' },
    })
    return { items: items.map(toCertificate) }
  }

  /** Публичная проверка: без авторизации, только данные документа. */
  async verify(code: string) {
    const certificate = await this.prisma.client.certificate.findUnique({
      where: { verificationCode: code.trim().toUpperCase() },
      include: certificateInclude,
    })
    if (!certificate) throw notFound('Сертификат с таким кодом не найден')

    const expired = certificate.expiresAt !== null && certificate.expiresAt.getTime() < Date.now()
    return {
      valid: certificate.status === 'ISSUED' && !expired,
      expired,
      status: certificate.status,
      number: certificate.number,
      student: {
        firstName: certificate.student.firstName,
        lastName: certificate.student.lastName,
      },
      course: { title: certificate.course.title },
      issuedAt: certificate.issuedAt,
      expiresAt: certificate.expiresAt,
      revokedAt: certificate.revokedAt,
      revokeReason: certificate.revokeReason,
      issuedBy: staffName(certificate.issuedBy),
    }
  }

  /** Ручная выдача администратором: автоматических вызовов выдачи нет. */
  async issue(input: CertificateIssueInput, actorId: string) {
    const student = await this.prisma.client.user.findFirst({
      where: { id: input.studentId, role: 'STUDENT', deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
    })
    if (!student) throw badRequest('Ученик не найден')

    const course = await this.prisma.client.course.findUnique({
      where: { id: input.courseId },
      select: { id: true, title: true },
    })
    if (!course) throw badRequest('Курс не найден')

    const enrollment = await this.prisma.client.courseEnrollment.findUnique({
      where: { courseId_studentId: { courseId: course.id, studentId: student.id } },
      select: { id: true },
    })
    if (!enrollment) throw badRequest('Ученик не записан на этот курс')

    const existing = await this.prisma.client.certificate.findUnique({
      where: { studentId_courseId: { studentId: student.id, courseId: course.id } },
      select: { number: true },
    })
    if (existing) throw conflict(`Сертификат по этому курсу уже выдан: ${existing.number}`)

    if (!isCertificateFileUrl(input.fileUrl) || !certificateFileMatchesMime(input.fileUrl, input.mimeType)) {
      throw badRequest('Сертификат выдаётся только с загруженным PDF или изображением')
    }

    const issuedAt = input.issuedAt ? new Date(input.issuedAt) : new Date()
    const year = issuedAt.getUTCFullYear()

    let created: CertificateRow
    try {
      created = await this.prisma.client.$transaction(async (tx) => {
        // Атомарный счётчик года: параллельные выдачи не получают один номер.
        const [sequence] = await tx.$queryRaw<Array<{ value: number }>>`
          INSERT INTO "CertificateSequence" ("year", "value") VALUES (${year}, 1)
          ON CONFLICT ("year") DO UPDATE SET "value" = "CertificateSequence"."value" + 1
          RETURNING "value"
        `
        if (!sequence) throw new Error('Не удалось получить номер сертификата')
        return tx.certificate.create({
          data: {
            number: certificateNumber(year, sequence.value),
            verificationCode: createVerificationCode(),
            studentId: student.id,
            courseId: course.id,
            issuedById: actorId,
            grade: input.grade ?? null,
            issuedAt,
            expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
            fileUrl: input.fileUrl,
            fileName: input.fileName,
            mimeType: input.mimeType,
            fileSize: input.fileSize,
          },
          include: certificateInclude,
        })
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('Сертификат уже выдан или код проверки занят — повторите выдачу')
      }
      throw error
    }

    await writeAudit({
      actorId,
      action: 'certificate.issued',
      entity: 'certificate',
      entityId: created.id,
      metadata: {
        number: created.number,
        studentId: student.id,
        courseId: course.id,
        grade: created.grade,
        fileUrl: created.fileUrl,
        fileName: created.fileName,
        mimeType: created.mimeType,
        fileSize: created.fileSize,
      },
    })

    await this.notify({
      userId: student.id,
      type: 'CERTIFICATE_ISSUED',
      title: 'Сертификат выдан',
      body: `Сертификат ${created.number} по курсу «${course.title}» доступен в профиле`,
      data: { certificateId: created.id, number: created.number, courseId: course.id },
    })

    return toCertificate(created)
  }

  async revoke(id: string, reason: string, actorId: string) {
    const certificate = await this.prisma.client.certificate.findUnique({
      where: { id },
      include: certificateInclude,
    })
    if (!certificate) throw notFound('Сертификат не найден')
    if (certificate.status === 'REVOKED') throw conflict('Сертификат уже отозван')

    const revoked = await this.prisma.client.certificate.update({
      where: { id },
      data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: reason },
      include: certificateInclude,
    })

    await writeAudit({
      actorId,
      action: 'certificate.revoked',
      entity: 'certificate',
      entityId: id,
      metadata: { number: certificate.number, reason, studentId: certificate.studentId },
    })

    await this.notify({
      userId: certificate.studentId,
      type: 'CERTIFICATE_REVOKED',
      title: 'Сертификат отозван',
      body: `Сертификат ${certificate.number} по курсу «${certificate.course.title}» отозван: ${reason}`,
      data: { certificateId: id, number: certificate.number, courseId: certificate.courseId },
    })

    return toCertificate(revoked)
  }

  /** Отдаёт только файл, загруженный в каталог вложений; путь собирается из имени без обхода каталогов. */
  async file(
    id: string,
    user: { userId: string; role: RoleName },
  ): Promise<{ stream: ReturnType<typeof createReadStream>; size: number; mimeType: string; fileName: string }> {
    const certificate = await this.prisma.client.certificate.findUnique({
      where: { id },
      select: { studentId: true, fileUrl: true, fileName: true, mimeType: true },
    })
    if (!certificate) throw notFound('Сертификат не найден')
    if (user.role !== 'ADMIN' && certificate.studentId !== user.userId) {
      throw forbidden('Файл сертификата доступен только ученику и администратору')
    }
    if (!certificate.fileUrl) throw notFound('У сертификата нет загруженного файла')

    let pathname: string
    try {
      pathname = new URL(certificate.fileUrl).pathname
    } catch {
      throw notFound('Ссылка на файл сертификата некорректна')
    }
    // Новый формат ссылки — /api/uploads/certificates/<file>, старый — /uploads/...
    const fromUploadsApi = pathname.startsWith('/api/uploads/certificates/')
    if (!fromUploadsApi && !pathname.startsWith('/uploads/')) {
      throw notFound('Файл сертификата не найден')
    }

    const root = getTenant()?.uploadsDir ?? resolve(process.env.UPLOADS_DIR ?? 'uploads')
    // Новые сертификаты лежат в uploads/certificates и не отдаются статикой.
    const inCertificatesDir = fromUploadsApi || pathname.startsWith('/uploads/certificates/')
    const file = inCertificatesDir
      ? resolve(root, 'certificates', basename(pathname))
      : resolve(root, basename(pathname))
    const info = await stat(file).catch(() => null)
    if (!info?.isFile()) throw notFound('Файл сертификата не найден')

    const fileName = certificate.fileName ?? basename(file)
    const mimeType = certificate.mimeType ?? 'application/octet-stream'
    void writeFileAudit({
      userId: user.userId,
      action: 'DOWNLOAD',
      fileName,
      mimeType,
      sizeBytes: info.size,
    })

    return {
      stream: createReadStream(file),
      size: info.size,
      mimeType,
      fileName,
    }
  }

  async html(id: string, user: { userId: string; role: RoleName }): Promise<string> {
    const certificate = await this.prisma.client.certificate.findUnique({
      where: { id },
      include: certificateInclude,
    })
    if (!certificate) throw notFound('Сертификат не найден')
    if (user.role !== 'ADMIN' && certificate.studentId !== user.userId) {
      throw forbidden('Сертификат доступен только ученику и администратору')
    }

    return buildCertificateHtml({
      number: certificate.number,
      verificationCode: certificate.verificationCode,
      verifyUrl: `${adminWebOrigin()}/verify/${certificate.verificationCode}`,
      studentName: `${certificate.student.firstName} ${certificate.student.lastName}`.trim(),
      courseTitle: certificate.course.title,
      issuedAt: certificate.issuedAt,
      grade: certificate.grade,
      status: certificate.status,
      revokedAt: certificate.revokedAt,
      revokeReason: certificate.revokeReason,
      issuedByName: staffName(certificate.issuedBy),
    })
  }

  /** Уведомление и push не должны ломать выдачу/отзыв сертификата. */
  private async notify(input: {
    userId: string
    type: 'CERTIFICATE_ISSUED' | 'CERTIFICATE_REVOKED'
    title: string
    body: string
    data: Record<string, unknown>
  }): Promise<void> {
    try {
      await notifyUsers([input.userId], {
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data,
        email: { subject: `ITadis: ${input.title}`, text: input.body },
      })
    } catch (error) {
      console.error('[certificates] не удалось отправить уведомление', error)
    }
  }
}
