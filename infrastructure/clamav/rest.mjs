// HTTP-обёртка над clamd (INSTREAM) для backend ITadis.
//
// Приложение (`apps/api/src/lib/file-scan.ts`) при ANTIVIRUS_PROVIDER=clamav
// отправляет сырое тело файла POST-запросом и ждёт JSON:
//   { "clean": true }                      — файл чистый
//   { "clean": false, "reason": "..." }    — найдена угроза
// Официальный образ clamav/clamav отдаёт только бинарный протокол на 3310,
// поэтому этот сервис переводит HTTP в INSTREAM. Зависимостей нет.
import { createServer } from 'node:http'
import net from 'node:net'

const PORT = Number(process.env.PORT ?? 8080)
const CLAMD_HOST = process.env.CLAMD_HOST ?? 'clamav'
const CLAMD_PORT = Number(process.env.CLAMD_PORT ?? 3310)
const API_KEY = process.env.ANTIVIRUS_API_KEY ?? ''
const MAX_BYTES = Number(process.env.MAX_SCAN_BYTES ?? 512 * 1024 * 1024)
const TIMEOUT_MS = Number(process.env.SCAN_TIMEOUT_MS ?? 120_000)

/**
 * Передаёт поток в clamd командой zINSTREAM и возвращает его ответ.
 * Формат: 4 байта длины (big-endian) + чанк, терминатор — четыре нуля.
 */
function clamdInstream(stream) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(CLAMD_PORT, CLAMD_HOST)
    let reply = ''
    let settled = false

    const fail = (error) => {
      if (settled) return
      settled = true
      stream.destroy()
      socket.destroy()
      reject(error)
    }

    socket.setTimeout(TIMEOUT_MS)
    socket.on('timeout', () => fail(new Error('clamd не ответил за отведённое время')))
    socket.on('error', fail)
    socket.on('data', (chunk) => {
      reply += chunk.toString('utf8')
    })
    socket.on('close', () => {
      if (settled) return
      settled = true
      resolve(reply.replace(/\0/g, '').trim())
    })

    socket.on('connect', () => {
      socket.write('zINSTREAM\0')
      stream.on('data', (chunk) => {
        const size = Buffer.alloc(4)
        size.writeUInt32BE(chunk.length)
        if (!socket.write(Buffer.concat([size, chunk]))) {
          stream.pause()
          socket.once('drain', () => stream.resume())
        }
      })
      stream.on('end', () => {
        socket.write(Buffer.from([0, 0, 0, 0]))
        socket.end()
      })
      stream.on('error', fail)
    })
  })
}

/**
 * `stream: OK` — чисто, `stream: <signature> FOUND` — угроза, иначе сбой проверки.
 * Сбой отдаётся с HTTP 503: backend различает INFECTED и ERROR по статусу ответа.
 */
function verdict(reply) {
  if (/^stream: OK$/i.test(reply)) return { clean: true }
  const found = reply.match(/^stream: (.+) FOUND$/i)
  if (found) return { clean: false, reason: `Обнаружено: ${found[1]}` }
  if (/ERROR/i.test(reply)) {
    return { clean: false, failed: true, reason: `Антивирусный сканер сообщил ошибку: ${reply.slice(0, 200)}` }
  }
  return { clean: false, failed: true, reason: 'Сканер не вернул вердикт' }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    const socket = net.connect(CLAMD_PORT, CLAMD_HOST)
    const fail = () => {
      socket.destroy()
      sendJson(res, 503, { status: 'clamd_unavailable' })
    }
    socket.setTimeout(5_000)
    socket.once('error', fail)
    socket.once('timeout', fail)
    socket.once('connect', () => {
      socket.write('zPING\0')
      socket.once('data', (chunk) => {
        socket.destroy()
        if (chunk.toString().includes('PONG')) sendJson(res, 200, { status: 'ok' })
        else sendJson(res, 503, { status: 'clamd_unavailable' })
      })
    })
    return
  }

  if (req.method !== 'POST' || !['/scan', '/'].includes(req.url ?? '')) {
    sendJson(res, 404, { error: 'not_found' })
    return
  }

  if (API_KEY && req.headers['x-api-key'] !== API_KEY) {
    sendJson(res, 401, { error: 'unauthorized' })
    return
  }

  const declared = Number(req.headers['content-length'] ?? 0)
  if (declared > MAX_BYTES) {
    sendJson(res, 413, { clean: false, reason: 'Файл больше лимита антивирусной проверки' })
    req.destroy()
    return
  }

  try {
    const reply = await clamdInstream(req)
    const result = verdict(reply)
    sendJson(res, result.failed ? 503 : 200, {
      clean: result.clean,
      ...(result.reason ? { reason: result.reason } : {}),
    })
  } catch (error) {
    sendJson(res, 503, {
      clean: false,
      reason: error instanceof Error ? error.message : 'Антивирусная проверка недоступна',
    })
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`clamav-rest: http://0.0.0.0:${PORT}/scan → clamd ${CLAMD_HOST}:${CLAMD_PORT}`)
})
