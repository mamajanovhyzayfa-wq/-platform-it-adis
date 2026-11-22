import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const EICAR = String.raw`X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`

let directory = ''
let scanFile: typeof import('../src/lib/file-scan.js').scanFile

beforeAll(async () => {
  vi.stubEnv('ANTIVIRUS_SCAN_URL', '')
  vi.resetModules()
  scanFile = (await import('../src/lib/file-scan.js')).scanFile
  directory = await mkdtemp(join(tmpdir(), 'itadis-scan-'))
})

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

async function sample(name: string, content: string | Buffer): Promise<string> {
  const path = join(directory, name)
  await writeFile(path, content)
  return path
}

describe('потоковая проверка файлов', () => {
  it('находит EICAR и возвращает хеш', async () => {
    const result = await scanFile(await sample('eicar.txt', EICAR))
    expect(result.clean).toBe(false)
    expect(result.status).toBe('INFECTED')
    expect(result.sha256).toHaveLength(64)
  })

  it('отклоняет PDF, выданный за изображение', async () => {
    const result = await scanFile(await sample('fake.png', '%PDF-1.7\nnot an image'), 'image/png')
    expect(result.clean).toBe(false)
    expect(result.status).toBe('TYPE_MISMATCH')
  })

  it('принимает корректный PDF и исполняемые сигнатуры', async () => {
    const pdf = await scanFile(await sample('document.pdf', '%PDF-1.7\ncontent'), 'application/pdf')
    expect(pdf).toMatchObject({ clean: true, status: 'CLEAN' })

    const elf = await scanFile(await sample('binary.bin', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02])))
    expect(elf.clean).toBe(false)
    expect(elf.status).toBe('SIGNATURE')
  })
})

describe('внешний scan-API', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('отправляет файл в Cloudmersive multipart-запросом и принимает чистый вердикт', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ CleanResult: true }), { status: 200 }))
    vi.stubEnv('ANTIVIRUS_SCAN_URL', 'https://scanner.test/virus/scan/file')
    vi.stubEnv('ANTIVIRUS_PROVIDER', 'cloudmersive')
    vi.stubEnv('ANTIVIRUS_API_KEY', 'test-key')
    vi.stubGlobal('fetch', fetchMock)
    vi.resetModules()

    const { scanFile: scanWithProvider } = await import('../src/lib/file-scan.js')
    const result = await scanWithProvider(await sample('clean.pdf', '%PDF-1.7\ncontent'), 'application/pdf')

    expect(result).toMatchObject({ clean: true, status: 'EXTERNAL' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://scanner.test/virus/scan/file')
    expect((init.headers as Record<string, string>).apikey).toBe('test-key')
    expect(init.body).toBeInstanceOf(FormData)
  })

  it('считает файл заражённым по вердикту MetaDefender', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ scan_results: { scan_all_result_i: 1, scan_all_result_a: 'Trojan.Win32' } }), {
        status: 200,
      }),
    )
    vi.stubEnv('ANTIVIRUS_SCAN_URL', 'https://scanner.test/v4/file')
    vi.stubEnv('ANTIVIRUS_PROVIDER', 'metadefender')
    vi.stubGlobal('fetch', fetchMock)
    vi.resetModules()

    const { scanFile: scanWithProvider } = await import('../src/lib/file-scan.js')
    const result = await scanWithProvider(await sample('infected.pdf', '%PDF-1.7\ncontent'), 'application/pdf')

    expect(result.clean).toBe(false)
    expect(result.status).toBe('INFECTED')
    expect(result.reason).toContain('Trojan')
  })

  it('не пропускает файл, если сканер не вернул вердикт', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))
    vi.stubEnv('ANTIVIRUS_SCAN_URL', 'https://scanner.test/v4/file')
    vi.stubEnv('ANTIVIRUS_PROVIDER', 'metadefender')
    vi.stubGlobal('fetch', fetchMock)
    vi.resetModules()

    const { scanFile: scanWithProvider } = await import('../src/lib/file-scan.js')
    const result = await scanWithProvider(await sample('no-verdict.pdf', '%PDF-1.7\ncontent'), 'application/pdf')

    expect(result.clean).toBe(false)
    expect(result.status).toBe('ERROR')
  })
})
