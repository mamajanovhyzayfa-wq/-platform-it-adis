import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { env } from '../config/env.js'

/**
 * Единый интерфейс объектного хранилища.
 *
 * В production задаются S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY —
 * файлы филиала лежат в бакете под префиксом branches/{slug}/library/.
 * Без S3 используется STORAGE_DIR (не публичный каталог), что удобно для
 * локальной разработки и одного сервера. Ключи всегда строятся на сервере:
 * клиент не может выбрать путь или выйти за пределы своего филиала.
 */
export type StorageDriver = 'local' | 's3'

let s3: S3Client | null = null

export function isS3Configured(): boolean {
  return Boolean(env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY && env.S3_SECRET_KEY)
}

export function storageDriver(): StorageDriver {
  return isS3Configured() ? 's3' : 'local'
}

export function getS3Client(): S3Client {
  if (!isS3Configured()) throw new Error('S3 не настроен')
  s3 ??= new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: env.S3_ACCESS_KEY!, secretAccessKey: env.S3_SECRET_KEY! },
  })
  return s3
}

export function branchStoragePrefix(branchSlug: string): string {
  // Slug приходит из реестра филиалов, но ключ объекта не должен зависеть от
  // того, что записано в БД: небезопасный slug отклоняем, а не «исправляем».
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/i.test(branchSlug)) {
    throw new Error('Недопустимый slug филиала')
  }
  return `branches/${branchSlug}/library`
}

/** Расширение из имени файла пользователя: только точка и 1–12 букв/цифр. */
function safeExtension(extension: string): string {
  const normalized = extension.trim().toLowerCase()
  return /^\.[a-z0-9]{1,12}$/.test(normalized) ? normalized : '.bin'
}

export function makeStorageKey(branchSlug: string, extension: string): string {
  return `${branchStoragePrefix(branchSlug)}/${randomUUID()}${safeExtension(extension)}`
}

function assertSafeKey(key: string): void {
  if (!key || key.startsWith('/') || key.includes('..') || key.includes('\\')) {
    throw new Error('Недопустимый ключ объекта')
  }
}

function localRoot(): string {
  return resolve(env.STORAGE_DIR)
}

function localPath(key: string): string {
  assertSafeKey(key)
  const root = localRoot()
  const path = resolve(root, key)
  if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error('Ключ вне хранилища')
  return path
}

export async function saveObject(key: string, sourcePath: string, contentType: string): Promise<void> {
  assertSafeKey(key)
  if (isS3Configured()) {
    const body = createReadStream(sourcePath)
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET!,
        Key: key,
        Body: body,
        ContentType: contentType,
        Metadata: { source: 'itadis-library' },
      }),
    )
    return
  }
  const target = localPath(key)
  await mkdir(dirname(target), { recursive: true })
  await pipeline(createReadStream(sourcePath), createWriteStream(target))
}

export interface StoredObject {
  stream: Readable
  size?: number
  contentType?: string
}

export async function openObject(key: string): Promise<StoredObject> {
  assertSafeKey(key)
  if (isS3Configured()) {
    const result = await getS3Client().send(
      new GetObjectCommand({ Bucket: env.S3_BUCKET!, Key: key }),
    )
    if (!result.Body) throw new Error('Пустой объект в S3')
    return {
      stream: result.Body as Readable,
      size: result.ContentLength,
      contentType: result.ContentType,
    }
  }
  const path = localPath(key)
  const info = await stat(path)
  return { stream: createReadStream(path), size: info.size }
}

export async function objectExists(key: string): Promise<boolean> {
  assertSafeKey(key)
  if (isS3Configured()) {
    try {
      await getS3Client().send(new HeadObjectCommand({ Bucket: env.S3_BUCKET!, Key: key }))
      return true
    } catch {
      return false
    }
  }
  try {
    await stat(localPath(key))
    return true
  } catch {
    return false
  }
}

export async function deleteObject(key: string): Promise<void> {
  assertSafeKey(key)
  if (isS3Configured()) {
    await getS3Client().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET!, Key: key }))
    return
  }
  await rm(localPath(key), { force: true })
}

export interface ObjectInfo {
  key: string
  size: number
}

export async function listObjects(prefix: string): Promise<ObjectInfo[]> {
  assertSafeKey(prefix.replace(/\/$/, ''))
  if (isS3Configured()) {
    const objects: ObjectInfo[] = []
    let continuationToken: string | undefined
    do {
      const page = await getS3Client().send(
        new ListObjectsV2Command({
          Bucket: env.S3_BUCKET!,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      )
      for (const item of page.Contents ?? []) {
        if (item.Key) objects.push({ key: item.Key, size: item.Size ?? 0 })
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (continuationToken)
    return objects
  }

  const root = localRoot()
  const start = localPath(prefix)
  const objects: ObjectInfo[] = []
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile()) {
        const info = await stat(full)
        objects.push({ key: relative(root, full).split(sep).join('/'), size: info.size })
      }
    }
  }
  try {
    await walk(start)
  } catch {
    return []
  }
  return objects
}

/** Скачивает префикс во временный каталог (для резервного копирования S3-файлов). */
export async function downloadPrefix(prefix: string, destination: string): Promise<number> {
  const objects = await listObjects(prefix)
  await mkdir(destination, { recursive: true })
  for (const object of objects) {
    const target = join(destination, object.key.slice(prefix.replace(/\/$/, '').length + 1))
    await mkdir(dirname(target), { recursive: true })
    const stored = await openObject(object.key)
    await pipeline(stored.stream, createWriteStream(target))
  }
  return objects.length
}

/** Загружает локальный каталог в префикс S3 (восстановление файлов в объектном хранилище). */
export async function uploadDirectory(directory: string, prefix: string): Promise<number> {
  if (!isS3Configured()) return 0
  let uploaded = 0
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile()) {
        const key = `${prefix.replace(/\/$/, '')}/${relative(directory, full).split(sep).join('/')}`
        await getS3Client().send(
          new PutObjectCommand({
            Bucket: env.S3_BUCKET!,
            Key: key,
            Body: createReadStream(full),
          }),
        )
        uploaded += 1
      }
    }
  }
  await walk(directory)
  return uploaded
}

/** Резервные копии лежат в отдельном бакете/префиксе, не в публичной библиотеке. */
export async function saveBackupObject(key: string, sourcePath: string): Promise<void> {
  if (!isS3Configured()) return
  assertSafeKey(key)
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET!,
      Key: key,
      Body: createReadStream(sourcePath),
      ContentType: 'application/octet-stream',
    }),
  )
}

export async function downloadBackupObject(key: string, destination: string): Promise<void> {
  if (!isS3Configured()) throw new Error('S3 не настроен')
  assertSafeKey(key)
  const result = await getS3Client().send(new GetObjectCommand({ Bucket: env.S3_BUCKET!, Key: key }))
  if (!result.Body) throw new Error('Резервная копия не найдена в S3')
  await mkdir(dirname(destination), { recursive: true })
  await pipeline(result.Body as Readable, createWriteStream(destination))
}

/** Записывает строку в локальный файл (используется для .sha256). */
export async function writeLocalFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf8')
}
