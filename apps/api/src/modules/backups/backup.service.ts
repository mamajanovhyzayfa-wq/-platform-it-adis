import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, cp, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { Logger } from '@nestjs/common'
import { Prisma, type BackupKind, type BackupRun, type Branch } from '@prisma/client'
import { env } from '../../config/env.js'
import { controlPrisma } from '../../lib/control-prisma.js'
import { prisma } from '../../lib/prisma.js'
import { disconnectBranchClients, getBranchPrisma, tenantUploadsDir } from '../../lib/tenant.js'
import { branchDirectDatabaseUrl, directDatabaseUrl } from '../../lib/database-url.js'
import { downloadPrefix, isS3Configured, deleteObject, listObjects, uploadDirectory, saveBackupObject, downloadBackupObject } from '../../lib/file-storage.js'
import { withDistributedLock } from '../../lib/redis.js'
import { sendAlert } from '../../lib/notify-alert.js'
import { badRequest, conflict, notFound } from '../../lib/errors.js'

/**
 * Резервное копирование и восстановление филиалов.
 *
 * БД: pg_dump в custom-формате, ежедневно по умолчанию; файлы: tar.gz
 * каталога uploads (и объектов S3, если включено объектное хранилище).
 * Каждая копия получает SHA-256 и проверяется: pg_restore --list для БД,
 * tar -tzf для файлов. Retention и частота — поля Branch, меняются администратором.
 *
 * Восстановление НИКОГДА не запускается планировщиком. Это отдельная заявка:
 * DETECTED → AWAITING_APPROVAL → APPROVED → RUNNING → VERIFIED/FAILED, причём
 * approve и execute требуют step-up подтверждения ответственного лица.
 */

const logger = new Logger('Backups')

const backupRoot = resolve(env.BACKUP_DIR)

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/** pg_dump/pg_restore работают через прямое подключение, не через PgBouncer. */
function databaseUrlFor(branch: Branch): string {
  if (!branch.isPrimary) return branchDirectDatabaseUrl(branch.databaseName)
  return directDatabaseUrl()
}

function backupKey(branch: Branch, kind: BackupKind, suffix: string): string {
  return `backups/${branch.slug}/${kind.toLowerCase()}/${timestamp()}-${suffix}`
}

/** Точная фраза, которую вводит ответственный перед необратимым восстановлением. */
export function restoreConfirmationPhrase(branchSlug: string): string {
  return `RESTORE ${branchSlug}`
}

function localBackupPath(key: string): string {
  const root = backupRoot
  // S3-ключи начинаются с backups/; в BACKUP_DIR этот префикс уже не нужен.
  const localKey = key.replace(/^backups\//, '')
  const path = resolve(root, localKey)
  if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error('Ключ резервной копии вне BACKUP_DIR')
  return path
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolvePromise(hash.digest('hex')))
  })
}

async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size
}

/** Считает файлы в каталоге, не следуя по символическим ссылкам. */
async function countFilesRecursive(directory: string, skipName?: string): Promise<number> {
  let count = 0
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (skipName && entry.name === skipName) continue
    const full = join(directory, entry.name)
    if (entry.isDirectory()) count += await countFilesRecursive(full)
    else if (entry.isFile()) count += 1
  }
  return count
}

function runCommand(command: string, args: string[], timeoutMs = env.BACKUP_COMMAND_TIMEOUT_MS): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`${command} превысил лимит времени ${Math.round(timeoutMs / 1000)} с`))
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      if (stdout.length > 100_000) stdout = stdout.slice(-100_000)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
      if (stderr.length > 20_000) stderr = stderr.slice(-20_000)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(
        new Error(
          error.message.includes('ENOENT')
            ? `${command} не найден. Установите postgresql-client в контейнер backend.`
            : error.message,
        ),
      )
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolvePromise(stdout)
      else reject(new Error(`${command} завершился с кодом ${code}: ${stderr.trim() || stdout.trim()}`))
    })
  })
}

async function ensureLocalBackup(run: BackupRun): Promise<string> {
  if (!run.storageKey) throw new Error('У копии нет ключа хранения')
  const path = localBackupPath(run.storageKey)
  try {
    await access(path)
    return path
  } catch {
    // Совместимость с копиями, созданными до нормализации пути (backups/backups/...).
    const legacyPath = resolve(backupRoot, run.storageKey)
    try {
      await access(legacyPath)
      return legacyPath
    } catch {
      if (!isS3Configured()) throw new Error('Файл резервной копии не найден локально')
      await downloadBackupObject(run.storageKey, path)
      return path
    }
  }
}

function safeTarEntries(listing: string): void {
  for (const entry of listing.split('\n')) {
    const value = entry.trim()
    if (!value) continue
    if (value.startsWith('/') || value.split('/').includes('..')) {
      throw new Error('Архив содержит недопустимый путь')
    }
  }
}

export async function verifyBackupRun(runId: string): Promise<BackupRun> {
  const run = await controlPrisma.backupRun.findUnique({ where: { id: runId } })
  if (!run) throw notFound('Резервная копия не найдена')
  if (run.status === 'RUNNING') throw conflict('Копия ещё создаётся')
  try {
    const path = await ensureLocalBackup(run)
    const actual = await sha256File(path)
    if (run.sha256 && actual !== run.sha256) throw new Error('SHA-256 не совпадает: копия повреждена')
    if (run.kind === 'DATABASE') {
      await runCommand(process.env.PG_RESTORE_BIN ?? 'pg_restore', ['--list', path], 60_000)
    } else {
      const listing = await runCommand('tar', ['-tzf', path], 60_000)
      safeTarEntries(listing)
    }
    return controlPrisma.backupRun.update({
      where: { id: run.id },
      data: { verifiedAt: new Date(), error: null },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const updated = await controlPrisma.backupRun.update({
      where: { id: run.id },
      data: { status: 'FAILED', error: message, verifiedAt: null },
    })
    await sendAlert('Резервная копия не прошла проверку целостности', {
      branchId: run.branchId,
      backupId: run.id,
      kind: run.kind,
      error: message,
    })
    return updated
  }
}

async function pruneOldRuns(branch: Branch, kind: BackupKind): Promise<void> {
  const cutoff = new Date(Date.now() - branch.backupRetentionDays * 24 * 60 * 60 * 1000)
  const old = await controlPrisma.backupRun.findMany({
    where: {
      branchId: branch.id,
      kind,
      startedAt: { lt: cutoff },
      status: { in: ['SUCCEEDED', 'FAILED'] },
      storageKey: { not: null },
    },
  })
  for (const run of old) {
    if (!run.storageKey) continue
    await deleteObject(run.storageKey).catch(() => undefined)
    await rm(localBackupPath(run.storageKey), { force: true }).catch(() => undefined)
    await rm(resolve(backupRoot, run.storageKey), { force: true }).catch(() => undefined)
    await controlPrisma.backupRun.update({
      where: { id: run.id },
      data: {
        storageKey: null,
        metadata: {
          ...((run.metadata as Prisma.JsonObject | null) ?? {}),
          purgedAt: new Date().toISOString(),
          retentionDays: branch.backupRetentionDays,
        },
      },
    })
  }
}

async function createDatabaseBackup(branch: Branch, _run: BackupRun, workDir: string): Promise<{ path: string; key: string }> {
  const key = backupKey(branch, 'DATABASE', 'database.dump')
  const path = join(workDir, 'database.dump')
  const url = databaseUrlFor(branch)
  await runCommand(process.env.PG_DUMP_BIN ?? 'pg_dump', [
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    '--lock-wait-timeout=30s',
    `--file=${path}`,
    url,
  ])
  await mkdir(dirname(localBackupPath(key)), { recursive: true })
  await cp(path, localBackupPath(key))
  await saveBackupObject(key, path)
  return { path, key }
}

async function createFilesBackup(
  branch: Branch,
  _run: BackupRun,
  workDir: string,
): Promise<{ path: string; key: string; count: number; fileCount: number }> {
  const staging = join(workDir, 'files')
  await mkdir(staging, { recursive: true })
  let count = 0

  const localUploads = tenantUploadsDir(branch.slug, branch.isPrimary)
  try {
    await access(localUploads)
    await cp(localUploads, join(staging, 'uploads'), { recursive: true, force: true })
    // Для primary каталог uploads содержит вложенные branches/* других филиалов.
    // Они не должны попадать в копию primary и не должны восстанавливаться поверх них.
    if (branch.isPrimary) await rm(join(staging, 'uploads', 'branches'), { recursive: true, force: true })
    count += 1
  } catch {
    // У филиала может не быть локальных файлов (например, всё в S3).
  }

  if (isS3Configured()) {
    count += await downloadPrefix(`branches/${branch.slug}/library`, join(staging, 'library'))
  } else {
    // Локальный driver библиотеки лежит в STORAGE_DIR, а не в uploads.
    const localLibrary = resolve(env.STORAGE_DIR, 'branches', branch.slug, 'library')
    try {
      await access(localLibrary)
      await cp(localLibrary, join(staging, 'library'), { recursive: true, force: true })
      count += 1
    } catch {
      // Библиотека может быть пустой.
    }
  }

  const fileCount = await countFilesRecursive(staging)
  const key = backupKey(branch, 'FILES', 'files.tar.gz')
  const path = join(workDir, 'files.tar.gz')
  await runCommand('tar', ['-czf', path, '-C', staging, '.'])
  await mkdir(dirname(localBackupPath(key)), { recursive: true })
  await cp(path, localBackupPath(key))
  await saveBackupObject(key, path)
  return { path, key, count, fileCount }
}

/**
 * Создаёт один вид копии. Возвращает null, если такая же задача уже выполняется
 * в другом экземпляре (Redis lock).
 */
export async function runBackup(
  branchId: string,
  kind: BackupKind,
): Promise<BackupRun | null> {
  const branch = await controlPrisma.branch.findUnique({ where: { id: branchId } })
  if (!branch) throw notFound('Филиал не найден')
  if (branch.status !== 'ACTIVE') throw conflict('Резервное копирование доступно только активному филиалу')

  return withDistributedLock(`backup:${branch.id}:${kind}`, env.BACKUP_COMMAND_TIMEOUT_MS + 5 * 60_000, async () => {
    const run = await controlPrisma.backupRun.create({
      data: { branchId: branch.id, kind, status: 'RUNNING' },
    })
    const workDir = join(tmpdir(), `itadis-backup-${run.id}`)
    await mkdir(workDir, { recursive: true })
    try {
      const result =
        kind === 'DATABASE'
          ? await createDatabaseBackup(branch, run, workDir)
          : await createFilesBackup(branch, run, workDir)
      const sha256 = await sha256File(result.path)
      const sizeBytes = BigInt(await fileSize(result.path))
      const updated = await controlPrisma.backupRun.update({
        where: { id: run.id },
        data: {
          status: 'SUCCEEDED',
          storageKey: result.key,
          sizeBytes,
          sha256,
          finishedAt: new Date(),
          metadata: {
            driver: isS3Configured() ? 's3' : 'local',
            branch: branch.slug,
            ...(kind === 'FILES'
              ? {
                  fileGroups: (result as { count?: number }).count ?? 0,
                  fileCount: (result as { fileCount?: number }).fileCount ?? 0,
                }
              : {}),
          },
        },
      })
      const verified = await verifyBackupRun(updated.id)
      await pruneOldRuns(branch, kind)
      await controlPrisma.branch.update({
        where: { id: branch.id },
        data: {
          lastBackupStatus: verified.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED',
          // Ручной запуск тоже сдвигает расписание, иначе планировщик сразу
          // сделает вторую копию, потому что lastBackupAt остался пустым.
          ...(kind === 'DATABASE' ? { lastBackupAt: new Date() } : {}),
        },
      })
      return verified
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`Backup ${branch.slug}/${kind} failed: ${message}`)
      const failed = await controlPrisma.backupRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', error: message, finishedAt: new Date() },
      })
      await controlPrisma.branch.update({
        where: { id: branch.id },
        data: {
          lastBackupStatus: 'FAILED',
          ...(kind === 'DATABASE' ? { lastBackupAt: new Date() } : {}),
        },
      })
      await sendAlert('Ошибка резервного копирования', {
        branchId: branch.id,
        branch: branch.slug,
        kind,
        error: message,
      })
      return failed
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
    }
  })
}

export async function runDueBackups(): Promise<void> {
  const branches = await controlPrisma.branch.findMany({ where: { status: 'ACTIVE', backupEnabled: true } })
  for (const branch of branches) {
    const due =
      !branch.lastBackupAt ||
      Date.now() - branch.lastBackupAt.getTime() >= branch.backupFrequencyHours * 60 * 60 * 1000
    if (!due) continue
    // runBackup сам обновляет lastBackupAt/lastBackupStatus, в том числе для
    // ручных запусков. Здесь нельзя перезаписывать время второй раз.
    await runBackup(branch.id, 'DATABASE')
    if (branch.backupIncludeFiles) await runBackup(branch.id, 'FILES')
  }
}

let timer: NodeJS.Timeout | null = null

/** Планировщик в процессе API; включается BACKUP_SCHEDULER_ENABLED=true. */
export function startBackupScheduler(): () => void {
  if (!env.BACKUP_SCHEDULER_ENABLED) {
    logger.log('Планировщик резервных копий выключен (BACKUP_SCHEDULER_ENABLED=false)')
    return () => undefined
  }
  let running = false
  const tick = async (): Promise<void> => {
    if (running) return
    running = true
    try {
      await runDueBackups()
    } catch (error) {
      await sendAlert('Сбой планировщика резервных копий', {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      running = false
    }
  }
  void tick()
  timer = setInterval(() => void tick(), 15 * 60_000)
  timer.unref()
  return () => {
    if (timer) clearInterval(timer)
    timer = null
  }
}

function readableBytes(value: bigint | null): number | null {
  return value === null ? null : Number(value)
}

export function serializeRun(run: BackupRun) {
  return {
    id: run.id,
    branchId: run.branchId,
    kind: run.kind,
    status: run.status,
    sizeBytes: readableBytes(run.sizeBytes),
    sha256: run.sha256,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    verifiedAt: run.verifiedAt,
    error: run.error,
    metadata: run.metadata,
    storageKey: run.status === 'SUCCEEDED' ? run.storageKey : undefined,
  }
}

type RestorePlanInput = {
  branch: Pick<Branch, 'id' | 'slug' | 'name'>
  databaseBackup: BackupRun
  filesBackup: BackupRun | null
}

/**
 * Шаг 3: явный план из семи шагов процедуры восстановления. План хранится
 * в заявке и показывается ответственному до подтверждения.
 */
export function buildRestorePlan(input: RestorePlanInput) {
  const phrase = restoreConfirmationPhrase(input.branch.slug)
  const databaseCheck = {
    sha256: input.databaseBackup.sha256,
    sizeBytes: readableBytes(input.databaseBackup.sizeBytes),
    verifiedAt: input.databaseBackup.verifiedAt?.toISOString() ?? null,
  }
  const filesCheck = input.filesBackup
    ? {
        sha256: input.filesBackup.sha256,
        sizeBytes: readableBytes(input.filesBackup.sizeBytes),
        verifiedAt: input.filesBackup.verifiedAt?.toISOString() ?? null,
      }
    : null

  return {
    branch: { id: input.branch.id, slug: input.branch.slug, name: input.branch.name },
    databaseBackup: {
      id: input.databaseBackup.id,
      startedAt: input.databaseBackup.startedAt,
      sizeBytes: readableBytes(input.databaseBackup.sizeBytes),
    },
    filesBackup: input.filesBackup
      ? {
          id: input.filesBackup.id,
          startedAt: input.filesBackup.startedAt,
          sizeBytes: readableBytes(input.filesBackup.sizeBytes),
        }
      : null,
    approvalPhrase: phrase,
    checks: { database: databaseCheck, files: filesCheck },
    steps: [
      '1. Обнаружение проблемы: зафиксировать инцидент и причину восстановления.',
      '2. Проверка копий: SHA-256, pg_restore --list для БД и tar -tzf для файлов.',
      '3. Подготовка плана: определить БД, файлы, окно простоя и ответственное лицо.',
      `4. Подтверждение ответственного: пароль и точная фраза «${phrase}».`,
      '5. Восстановление: pg_restore --clean и распаковка файлов.',
      '6. Проверка целостности: подключение к БД, ключевые таблицы и количество файлов.',
      '7. Отчёт: статус, результаты проверок и время завершения.',
    ],
    warning:
      'Восстановление БД перезаписывает текущие данные филиала. Оно выполняется только после подтверждения ответственного лица и не запускается автоматически.',
  }
}

/**
 * Шаг 1–3: обнаружение проблемы, проверка копий и план.
 * Восстановление здесь не начинается — только создаётся заявка на подтверждение.
 * Неудачная проверка тоже сохраняется в истории как FAILED.
 */
export async function createRestoreRequest(input: {
  branchId: string
  backupId: string
  filesBackupId?: string
  reason?: string
  requestedBy: string
}) {
  const branch = await controlPrisma.branch.findUnique({ where: { id: input.branchId } })
  if (!branch) throw notFound('Филиал не найден')
  const backup = await controlPrisma.backupRun.findFirst({
    where: { id: input.backupId, branchId: branch.id, status: 'SUCCEEDED' },
  })
  if (!backup) throw notFound('Успешная резервная копия БД не найдена')
  if (backup.kind !== 'DATABASE') throw badRequest('Основная копия должна быть копией базы данных')

  let files: BackupRun | null = null
  if (input.filesBackupId) {
    files = await controlPrisma.backupRun.findFirst({
      where: { id: input.filesBackupId, branchId: branch.id, status: 'SUCCEEDED', kind: 'FILES' },
    })
    if (!files) throw notFound('Резервная копия файлов не найдена')
  }

  const initialWarning =
    'Восстановление БД перезаписывает текущие данные филиала. Оно выполняется только после подтверждения ответственного лица и не запускается автоматически.'
  const request = await controlPrisma.restoreRequest.create({
    data: {
      branchId: branch.id,
      backupId: backup.id,
      status: 'DETECTED',
      reason: input.reason,
      requestedBy: input.requestedBy,
      plan: {
        branch: { id: branch.id, slug: branch.slug, name: branch.name },
        databaseBackup: {
          id: backup.id,
          startedAt: backup.startedAt,
          sizeBytes: readableBytes(backup.sizeBytes),
        },
        filesBackup: files
          ? { id: files.id, startedAt: files.startedAt, sizeBytes: readableBytes(files.sizeBytes) }
          : null,
        steps: [],
        warning: initialWarning,
      },
    },
  })

  try {
    const dbCheck = await verifyBackupRun(backup.id)
    if (dbCheck.status !== 'SUCCEEDED') {
      throw conflict('Резервная копия БД повреждена, выберите другую')
    }

    let filesCheck: BackupRun | null = null
    if (files) {
      filesCheck = await verifyBackupRun(files.id)
      if (filesCheck.status !== 'SUCCEEDED') {
        throw conflict('Резервная копия файлов повреждена, выберите другую')
      }
    }

    await controlPrisma.restoreRequest.update({
      where: { id: request.id },
      data: { status: 'CHECKED', checkedAt: new Date() },
    })

    const plan = buildRestorePlan({ branch, databaseBackup: dbCheck, filesBackup: filesCheck })
    await controlPrisma.restoreRequest.update({
      where: { id: request.id },
      data: { status: 'PLANNED', plannedAt: new Date(), plan },
    })

    return await controlPrisma.restoreRequest.update({
      where: { id: request.id },
      data: { status: 'AWAITING_APPROVAL' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await controlPrisma.restoreRequest.update({
      where: { id: request.id },
      data: {
        status: 'FAILED',
        error: message,
        checkedAt: new Date(),
        report: {
          steps: [{ key: 'backup_verification', status: 'failed', detail: message }],
          finishedAt: new Date().toISOString(),
        },
      },
    })
    throw error
  }
}

export async function approveRestore(input: {
  restoreId: string
  approvedBy: string
  phrase: string
}) {
  const request = await controlPrisma.restoreRequest.findUnique({
    where: { id: input.restoreId },
    include: { branch: true },
  })
  if (!request) throw notFound('Заявка на восстановление не найдена')
  if (request.status !== 'AWAITING_APPROVAL') throw conflict('Заявка уже обработана или не готова к подтверждению')
  const expected = restoreConfirmationPhrase(request.branch.slug)
  if (input.phrase.trim() !== expected) {
    throw badRequest(`Для подтверждения введите фразу «${expected}»`)
  }
  // Условный update не даёт двум ответственным подтвердить одну заявку
  // одновременно и перезаписать approvedBy.
  const approved = await controlPrisma.restoreRequest.updateMany({
    where: { id: request.id, status: 'AWAITING_APPROVAL' },
    data: {
      status: 'APPROVED',
      approvedBy: input.approvedBy,
      confirmationPhrase: expected,
      approvedAt: new Date(),
    },
  })
  if (approved.count !== 1) throw conflict('Заявка уже была подтверждена или отменена')
  return controlPrisma.restoreRequest.findUniqueOrThrow({ where: { id: request.id } })
}

async function restoreDatabase(branch: Branch, run: BackupRun): Promise<void> {
  const path = await ensureLocalBackup(run)
  // Освобождаем соединения этого инстанса, иначе pg_restore --clean не сможет
  // удалить объекты. Другие реплики должны быть остановлены на время окна.
  await disconnectBranchClients()
  if (branch.isPrimary) {
    // Primary использует общий пул DATABASE_URL и управляющую БД в той же базе.
    await prisma.$disconnect()
    await controlPrisma.$disconnect()
  }
  const url = databaseUrlFor(branch)
  await runCommand(process.env.PG_RESTORE_BIN ?? 'pg_restore', [
    // Ошибка не должна оставлять филиал с частично перезаписанной БД.
    '--single-transaction',
    '--exit-on-error',
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-privileges',
    `--dbname=${url}`,
    path,
  ])
}

async function restoreFiles(branch: Branch, run: BackupRun): Promise<void> {
  const path = await ensureLocalBackup(run)
  const listing = await runCommand('tar', ['-tzf', path], 60_000)
  safeTarEntries(listing)
  const staging = join(tmpdir(), `itadis-restore-${run.id}-${Date.now()}`)
  await mkdir(staging, { recursive: true })
  try {
    await runCommand('tar', ['-xzf', path, '-C', staging])
    const localSource = join(staging, 'uploads')
    const localTarget = tenantUploadsDir(branch.slug, branch.isPrimary)
    let localRestored = false
    try {
      await access(localSource)
      await mkdir(dirname(localTarget), { recursive: true })
      if (branch.isPrimary) {
        // primary хранит рядом uploads/branches/*, их нельзя затирать копией primary.
        const entries = await readdir(localTarget, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.name !== 'branches') await rm(join(localTarget, entry.name), { recursive: true, force: true })
        }
        await cp(localSource, localTarget, { recursive: true, force: true })
      } else {
        const previous = `${localTarget}.pre-restore-${Date.now()}`
        await rename(localTarget, previous).catch(() => undefined)
        await rename(localSource, localTarget)
      }
      localRestored = true
    } catch {
      // В архиве может не быть локальных файлов.
    }

    const librarySource = join(staging, 'library')
    let s3Restored = 0
    let localLibraryRestored = false
    if (isS3Configured()) {
      try {
        await access(librarySource)
        // Восстанавливаем точное состояние библиотеки, а не только перезапись
        // совпавших ключей. Копия уже проверена по SHA-256.
        const prefix = `branches/${branch.slug}/library`
        for (const object of await listObjects(prefix)) {
          await deleteObject(object.key)
        }
        s3Restored = await uploadDirectory(librarySource, prefix)
      } catch {
        // S3-группа могла отсутствовать в копии.
      }
    } else {
      try {
        await access(librarySource)
        const localLibrary = resolve(env.STORAGE_DIR, 'branches', branch.slug, 'library')
        await rm(localLibrary, { recursive: true, force: true })
        await cp(librarySource, localLibrary, { recursive: true, force: true })
        localLibraryRestored = true
      } catch {
        // Локальная библиотека могла отсутствовать в копии.
      }
    }
    if (!localRestored && !s3Restored && !localLibraryRestored) {
      throw new Error('В архиве не найдено ни локальных файлов, ни файлов библиотеки')
    }
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
  }
}

interface RestoreChecks {
  database: 'ok'
  users: number
  courses: number
  files: 'ok' | 'missing' | 'count-mismatch'
  restoredFiles: number
  expectedFiles: number | null
}

/**
 * Шаг 6: проверка не только соединения, но и ключевых таблиц и количества
 * файлов. Для primary не считаем вложенные uploads/branches других филиалов.
 */
async function verifyBranchAfterRestore(branch: Branch, expectedFiles: number | null): Promise<RestoreChecks> {
  const client = branch.isPrimary ? prisma : getBranchPrisma(branch.id, branch.databaseName)
  await client.$queryRaw`SELECT 1`
  const [userRow] = await client.$queryRaw<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM "User"`
  const [courseRow] = await client.$queryRaw<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM "Course"`

  let localFiles = 0
  let localPresent = false
  try {
    localFiles = await countFilesRecursive(
      tenantUploadsDir(branch.slug, branch.isPrimary),
      branch.isPrimary ? 'branches' : undefined,
    )
    localPresent = true
  } catch {
    // Каталога может не быть, если в филиале не было локальных вложений.
  }

  let libraryFiles = 0
  if (isS3Configured()) {
    libraryFiles = (await listObjects(`branches/${branch.slug}/library`)).length
  } else {
    try {
      libraryFiles = await countFilesRecursive(resolve(env.STORAGE_DIR, 'branches', branch.slug, 'library'))
    } catch {
      // Библиотека могла быть пустой.
    }
  }

  const restoredFiles = localFiles + libraryFiles
  const files =
    !localPresent && libraryFiles === 0
      ? 'missing'
      : expectedFiles !== null && restoredFiles !== expectedFiles
        ? 'count-mismatch'
        : 'ok'
  return {
    database: 'ok',
    users: userRow?.count ?? 0,
    courses: courseRow?.count ?? 0,
    files,
    restoredFiles,
    expectedFiles,
  }
}

/** Шаг 5–7: выполнение только по уже подтверждённой заявке, проверка и отчёт. */
export async function executeRestore(restoreId: string) {
  const existing = await controlPrisma.restoreRequest.findUnique({ where: { id: restoreId } })
  if (!existing) throw notFound('Заявка на восстановление не найдена')
  if (existing.status !== 'APPROVED') throw conflict('Восстановление не подтверждено ответственным лицом')
  if (!existing.confirmationPhrase) throw conflict('Отсутствует подтверждение ответственного лица')

  // Атомарный захват: два администратора не смогут запустить одно восстановление
  // одновременно, даже если оба нажали кнопку до обновления страницы.
  const claimed = await controlPrisma.restoreRequest.updateMany({
    where: { id: restoreId, status: 'APPROVED', confirmationPhrase: { not: null } },
    data: { status: 'RUNNING', executedAt: new Date(), error: null },
  })
  if (claimed.count !== 1) throw conflict('Восстановление уже запущено или заявка изменилась')

  const request = await controlPrisma.restoreRequest.findUnique({
    where: { id: restoreId },
    include: { branch: true },
  })
  if (!request) throw notFound('Заявка на восстановление не найдена')

  const report: Array<{ key: string; status: string; detail?: string }> = []
  try {
    const plan = (request.plan ?? {}) as { filesBackup?: { id?: string } | null }
    const dbBackup = await controlPrisma.backupRun.findUnique({ where: { id: request.backupId } })
    if (!dbBackup) throw notFound('Копия БД не найдена')
    const filesBackup = plan.filesBackup?.id
      ? await controlPrisma.backupRun.findUnique({ where: { id: plan.filesBackup.id } })
      : null

    const dbCheck = await verifyBackupRun(dbBackup.id)
    if (dbCheck.status !== 'SUCCEEDED') throw new Error('Копия БД не прошла проверку целостности')
    report.push({ key: 'database_backup_integrity', status: 'ok' })

    await restoreDatabase(request.branch, dbBackup)
    report.push({ key: 'database_restore', status: 'ok' })
    if (request.branch.isPrimary) {
      // В demo-primary управляющая БД совпадает с восстанавливаемой: заявка,
      // созданная после снимка, исчезает. Возвращаем её для отчёта.
      const stillThere = await controlPrisma.restoreRequest.findUnique({ where: { id: request.id } })
      if (!stillThere) {
        await controlPrisma.restoreRequest.create({
          data: {
            id: request.id,
            branchId: request.branchId,
            backupId: request.backupId,
            status: 'RUNNING',
            reason: request.reason,
            requestedBy: request.requestedBy,
            approvedBy: request.approvedBy,
            confirmationPhrase: request.confirmationPhrase,
            plan: request.plan ?? undefined,
            detectedAt: request.detectedAt,
            checkedAt: request.checkedAt,
            plannedAt: request.plannedAt,
            approvedAt: request.approvedAt,
            executedAt: new Date(),
          },
        })
      }
    }

    let expectedFiles: number | null = null
    if (filesBackup) {
      const filesCheck = await verifyBackupRun(filesBackup.id)
      if (filesCheck.status !== 'SUCCEEDED') throw new Error('Копия файлов не прошла проверку целостности')
      report.push({ key: 'files_backup_integrity', status: 'ok' })
      await restoreFiles(request.branch, filesBackup)
      report.push({ key: 'files_restore', status: 'ok' })
      const meta = (filesBackup.metadata ?? {}) as { fileCount?: unknown }
      if (typeof meta.fileCount === 'number') expectedFiles = meta.fileCount
    } else {
      report.push({ key: 'files_restore', status: 'skipped', detail: 'Копия файлов не выбрана' })
    }

    // Снимок мог содержать выбранную копию в статусе RUNNING (primary, где
    // управляющая БД совпадает с восстанавливаемой). Копия проверена — фиксируем.
    await controlPrisma.backupRun.update({
      where: { id: dbBackup.id },
      data: { status: 'SUCCEEDED', error: null },
    }).catch(() => undefined)
    if (filesBackup) {
      await controlPrisma.backupRun.update({
        where: { id: filesBackup.id },
        data: { status: 'SUCCEEDED', error: null },
      }).catch(() => undefined)
    }

    const checks = await verifyBranchAfterRestore(request.branch, expectedFiles)
    const integrityOk = checks.database === 'ok' && (!filesBackup || checks.files === 'ok')
    report.push({
      key: 'post_restore_check',
      status: integrityOk ? 'ok' : 'failed',
      detail: JSON.stringify(checks),
    })
    if (!integrityOk) {
      throw new Error('Проверка целостности после восстановления не пройдена')
    }

    return await controlPrisma.restoreRequest.update({
      where: { id: request.id },
      data: {
        status: 'VERIFIED',
        verifiedAt: new Date(),
        report: {
          steps: report,
          checks: { ...checks } as Prisma.InputJsonObject,
          requestedBy: request.requestedBy,
          approvedBy: request.approvedBy,
          finishedAt: new Date().toISOString(),
        },
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    report.push({ key: 'restore', status: 'failed', detail: message })
    await controlPrisma.restoreRequest.update({
      where: { id: request.id },
      data: {
        status: 'FAILED',
        error: message,
        report: { steps: report, finishedAt: new Date().toISOString() },
      },
    })
    await sendAlert('Ошибка восстановления филиала', {
      branchId: request.branchId,
      restoreId: request.id,
      error: message,
    })
    throw error
  }
}

export function backupRootInfo() {
  return { directory: backupRoot, driver: isS3Configured() ? 's3+local' : 'local', command: process.env.PG_DUMP_BIN ?? 'pg_dump' }
}

