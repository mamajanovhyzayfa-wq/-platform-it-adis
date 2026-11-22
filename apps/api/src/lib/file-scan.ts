import { createHash } from 'node:crypto'
import { openAsBlob, createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { Readable } from 'node:stream'
import { env } from '../config/env.js'

export interface ScanResult {
  clean: boolean
  status: 'CLEAN' | 'INFECTED' | 'SIGNATURE' | 'TYPE_MISMATCH' | 'EXTERNAL' | 'ERROR'
  sha256: string
  reason?: string
}

/**
 * Проверка, что заявленный MIME соответствует первым байтам файла. Это не
 * заменяет антивирус, но не даёт выдать HTML/скрипт за PDF или изображение.
 */
function matchesMagic(buffer: Buffer, mime: string): boolean {
  const hex = buffer.subarray(0, 16).toString('hex')
  const ascii = buffer.subarray(0, 16).toString('latin1')
  const starts = (prefix: string) => ascii.startsWith(prefix)
  if (mime === 'application/pdf') return starts('%PDF-')
  if (mime === 'image/png') return hex.startsWith('89504e47')
  if (mime === 'image/jpeg') return hex.startsWith('ffd8ff')
  if (mime === 'image/gif') return starts('GIF8')
  if (mime === 'image/webp') return starts('RIFF') && buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  if (mime === 'image/bmp') return starts('BM')
  if (mime === 'image/tiff') return hex.startsWith('49492a00') || hex.startsWith('4d4d002a')
  if (mime === 'image/heic') return buffer.subarray(4, 8).toString('latin1') === 'ftyp'
  if (mime === 'audio/mpeg') return starts('ID3') || hex.startsWith('fffb') || hex.startsWith('fff3')
  if (mime === 'audio/flac') return starts('fLaC')
  if (mime === 'audio/ogg' || mime === 'video/ogg') return starts('OggS')
  if (mime === 'audio/wav' || mime === 'audio/x-wav') return starts('RIFF') && buffer.subarray(8, 12).toString('latin1') === 'WAVE'
  if (mime === 'audio/webm' || mime === 'video/webm') return hex.startsWith('1a45dfa3')
  if (mime === 'video/mp4' || mime === 'audio/mp4' || mime === 'video/quicktime') {
    return buffer.subarray(4, 8).toString('latin1') === 'ftyp'
  }
  if (mime === 'video/x-msvideo') return starts('RIFF') && buffer.subarray(8, 12).toString('latin1') === 'AVI '
  if (mime === 'video/mpeg') return hex.startsWith('000001ba') || hex.startsWith('000001b3')
  if (mime === 'application/zip' || mime === 'application/x-zip-compressed' || mime.includes('openxmlformats')) {
    return hex.startsWith('504b0304') || hex.startsWith('504b0506')
  }
  if (mime === 'application/x-rar-compressed' || mime === 'application/vnd.rar') return starts('Rar!')
  if (mime === 'application/x-7z-compressed') return hex.startsWith('377abcaf271c')
  if (mime === 'application/gzip') return hex.startsWith('1f8b')
  if (mime === 'application/x-tar') return buffer.subarray(257, 262).toString('latin1') === 'ustar'
  if (mime === 'application/msword' || mime === 'application/vnd.ms-excel' || mime === 'application/vnd.ms-powerpoint') {
    return hex.startsWith('d0cf11e0a1b11ae1')
  }
  // Текстовые и JSON-форматы не имеют устойчивой сигнатуры.
  return true
}

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'

/**
 * Базовая проверка файла до публикации:
 * 1) SHA-256 для журнала и дедупликации;
 * 2) сигнатуры EICAR и исполняемых форматов;
 * 3) необязательный внешний антивирусный HTTP-сканер.
 *
 * Файл читается потоком: видео и архивы до 512 МБ не должны занимать всю память
 * процесса. Без ANTIVIRUS_SCAN_URL используется локальная сигнатурная проверка.
 * В production env.ts требует подключить ClamAV/корпоративный сканер через URL.
 */
export async function scanFile(path: string, declaredMime?: string): Promise<ScanResult> {
  const hash = createHash('sha256')
  let header = Buffer.alloc(0)
  let tail = ''
  let infected = false

  for await (const chunk of createReadStream(path)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    hash.update(buffer)
    if (header.length < 4096) {
      header = Buffer.concat([header, buffer.subarray(0, 4096 - header.length)])
    }
    // Ищем EICAR по всем чанкам, сохраняя хвост для сигнатуры на границе.
    const window = tail + buffer.toString('latin1')
    if (window.includes(EICAR)) infected = true
    tail = window.slice(-(EICAR.length - 1))
  }

  const sha256 = hash.digest('hex')
  if (infected) {
    return { clean: false, status: 'INFECTED', sha256, reason: 'Обнаружен тестовый антивирусный файл EICAR' }
  }

  if (declaredMime && !matchesMagic(header, declaredMime)) {
    return {
      clean: false,
      status: 'TYPE_MISMATCH',
      sha256,
      reason: `Содержимое файла не соответствует заявленному типу ${declaredMime}`,
    }
  }

  const magic = header.subarray(0, 4).toString('hex')
  // PE/ELF/Mach-O/скрипты запуска не должны попадать в общие вложения.
  if (magic.startsWith('4d5a') || magic === '7f454c46' || ['feedface', 'feedfacf', 'cafebabe'].includes(magic)) {
    return { clean: false, status: 'SIGNATURE', sha256, reason: 'Исполняемые файлы запрещены к загрузке' }
  }

  const scanUrl = env.ANTIVIRUS_SCAN_URL
  if (!scanUrl) {
    return { clean: true, status: 'CLEAN', sha256 }
  }

  return scanWithExternalService(scanUrl, path, sha256)
}

type ScanVerdict = { clean: boolean; reason?: string; failed?: boolean }

function toScanResult(verdict: ScanVerdict, sha256: string): ScanResult {
  if (verdict.clean) return { clean: true, status: 'EXTERNAL', sha256 }
  return {
    clean: false,
    status: verdict.failed ? 'ERROR' : 'INFECTED',
    sha256,
    ...(verdict.reason ? { reason: verdict.reason } : {}),
  }
}

/** Cloudmersive: CleanResult + список найденных угроз. */
function cloudmersiveVerdict(payload: unknown): ScanVerdict {
  const data = (payload ?? {}) as {
    CleanResult?: boolean
    FoundViruses?: Array<{ VirusName?: string }> | null
  }
  if (data.CleanResult === true) return { clean: true }
  if (data.CleanResult === false) {
    const names = (data.FoundViruses ?? []).map((item) => item.VirusName).filter(Boolean)
    return { clean: false, reason: names.length ? `Обнаружено: ${names.join(', ')}` : 'Сканер обнаружил угрозу' }
  }
  // Без явного вердикта файл не пропускаем.
  return { clean: false, failed: true, reason: 'Сканер не вернул вердикт' }
}

/** MetaDefender: scan_all_result_i = 0 — чисто, иначе угроза. */
function metaDefenderVerdict(payload: unknown): ScanVerdict {
  const data = (payload ?? {}) as {
    scan_results?: { scan_all_result_i?: number; scan_all_result_a?: string }
  }
  const results = data.scan_results
  if (!results || typeof results.scan_all_result_i !== 'number') {
    return { clean: false, failed: true, reason: 'Сканер не завершил проверку файла' }
  }
  if (results.scan_all_result_i !== 0) {
    return {
      clean: false,
      reason: results.scan_all_result_a ? `Обнаружено: ${results.scan_all_result_a}` : 'Сканер обнаружил угрозу',
    }
  }
  return { clean: true }
}

/**
 * Внешний сканер. ClamAV REST принимает сырое тело файла, Cloudmersive и
 * MetaDefender — multipart. Файл передаётся Blob'ом с диска, поэтому вложение
 * до 10 МБ не буферизуется в памяти процесса целиком.
 */
async function scanWithExternalService(scanUrl: string, path: string, sha256: string): Promise<ScanResult> {
  const provider = env.ANTIVIRUS_PROVIDER
  try {
    if (provider === 'clamav') {
      const info = await stat(path)
      const response = await fetch(scanUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(info.size),
          ...(env.ANTIVIRUS_API_KEY ? { 'X-API-Key': env.ANTIVIRUS_API_KEY } : {}),
        },
        body: Readable.toWeb(createReadStream(path)) as unknown as RequestInit['body'],
        duplex: 'half',
        signal: AbortSignal.timeout(120_000),
      })
      if (!response.ok) {
        return { clean: false, status: 'ERROR', sha256, reason: `Антивирусный сканер вернул HTTP ${response.status}` }
      }
      const result = (await response.json().catch(() => ({}))) as { clean?: boolean; reason?: string }
      return {
        clean: result.clean !== false,
        status: result.clean === false ? 'INFECTED' : 'EXTERNAL',
        sha256,
        ...(result.reason ? { reason: result.reason } : {}),
      }
    }

    const form = new FormData()
    form.append(provider === 'cloudmersive' ? 'inputFile' : 'file', await openAsBlob(path), basename(path))
    const response = await fetch(scanUrl, {
      method: 'POST',
      headers: env.ANTIVIRUS_API_KEY ? { apikey: env.ANTIVIRUS_API_KEY } : {},
      body: form,
      signal: AbortSignal.timeout(120_000),
    })
    if (!response.ok) {
      return { clean: false, status: 'ERROR', sha256, reason: `Антивирусный сканер вернул HTTP ${response.status}` }
    }
    const payload = (await response.json().catch(() => null)) as unknown
    const verdict = provider === 'cloudmersive' ? cloudmersiveVerdict(payload) : metaDefenderVerdict(payload)
    return toScanResult(verdict, sha256)
  } catch (error) {
    return {
      clean: false,
      status: 'ERROR',
      sha256,
      reason: error instanceof Error ? error.message : 'Антивирусная проверка недоступна',
    }
  }
}
