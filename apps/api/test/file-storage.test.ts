import { afterEach, describe, expect, it, vi } from 'vitest'
import { branchStoragePrefix, makeStorageKey } from '../src/lib/file-storage.js'

const S3_KEYS = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('файловое хранилище: изоляция филиалов', () => {
  it('каждый филиал получает собственный префикс', () => {
    expect(branchStoragePrefix('filial-oshi')).toBe('branches/filial-oshi/library')
    expect(branchStoragePrefix('filial-bishkek')).toBe('branches/filial-bishkek/library')
    expect(branchStoragePrefix('filial-oshi')).not.toBe(branchStoragePrefix('filial-bishkek'))
  })

  it('ключ всегда лежит внутри префикса своего филиала', () => {
    const key = makeStorageKey('filial-oshi', '.pdf')
    expect(key.startsWith('branches/filial-oshi/library/')).toBe(true)
    expect(key).not.toContain('..')
    expect(key.startsWith('branches/filial-bishkek/')).toBe(false)
  })

  it('отклоняет slug, который может выйти за пределы каталога', () => {
    for (const slug of ['', '../other', 'a/b', 'a\\b', '.hidden', '-start', 'a'.repeat(70)]) {
      expect(() => branchStoragePrefix(slug)).toThrow('Недопустимый slug филиала')
    }
  })

  it('принимает slug филиала из реестра', () => {
    for (const slug of ['a', 'filial-oshi', 'branch-2', 'a'.repeat(63)]) {
      expect(branchStoragePrefix(slug)).toContain(`/${slug}/library`)
    }
  })
})

describe('файловое хранилище: имена объектов', () => {
  it('генерирует уникальные ключи с нормализованным расширением', () => {
    const first = makeStorageKey('filial-oshi', '.pdf')
    const second = makeStorageKey('filial-oshi', '.pdf')

    expect(first).not.toBe(second)
    expect(first.endsWith('.pdf')).toBe(true)
    expect(makeStorageKey('filial-oshi', '.PDF').endsWith('.pdf')).toBe(true)
    expect(makeStorageKey('filial-oshi', '.docx').endsWith('.docx')).toBe(true)
  })

  it('не пропускает путь и мусор из имени файла', () => {
    const attempts = ['../../etc/passwd', '.p/../df', '..', '.', '', '   ', '.toolongextension', 'jpg']

    for (const extension of attempts) {
      const key = makeStorageKey('filial-oshi', extension)
      expect(key.startsWith('branches/filial-oshi/library/')).toBe(true)
      expect(key).not.toContain('..')
      expect(key).not.toContain('/etc')
      expect(key.endsWith('.bin') || /^\.[a-z0-9]{1,12}$/.test(key.slice(key.lastIndexOf('.')))).toBe(true)
    }
  })

  it('включает S3 только при полном наборе настроек', async () => {
    // Пустые значения важнее удаления: dotenv не перезапишет их из .env машины.
    for (const key of S3_KEYS) vi.stubEnv(key, '')
    vi.resetModules()
    const local = await import('../src/lib/file-storage.js')
    expect(local.isS3Configured()).toBe(false)
    expect(local.storageDriver()).toBe('local')

    vi.stubEnv('S3_ENDPOINT', 'https://s3.example.com')
    vi.stubEnv('S3_BUCKET', 'itadis')
    vi.stubEnv('S3_ACCESS_KEY', 'test-key')
    vi.stubEnv('S3_SECRET_KEY', 'test-secret')
    vi.resetModules()
    const s3 = await import('../src/lib/file-storage.js')
    expect(s3.isS3Configured()).toBe(true)
    expect(s3.storageDriver()).toBe('s3')
  })
})
