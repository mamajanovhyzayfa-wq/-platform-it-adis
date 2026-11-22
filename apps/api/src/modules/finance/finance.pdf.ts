import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import PDFDocument from 'pdfkit'
import { CURRENCY } from './finance.calc.js'
import type { InvoiceCard } from './finance.mappers.js'
import { INVOICE_STATUS_LABELS, PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS } from './finance.shared.js'

const FONT_PATH = resolve(process.cwd(), 'assets/DejaVuSans.ttf')

/**
 * PDF-квитанция формируется на сервере, без внешнего сервиса.
 * Кириллица встроена шрифтом DejaVu Sans; файл шрифта лежит в backend/assets.
 */
export async function buildReceiptPdf(card: InvoiceCard): Promise<Buffer> {
  if (!existsSync(FONT_PATH)) throw new Error('Не найден шрифт для PDF-квитанции')
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Счёт ${card.number}`, Author: 'ITadis' } })
  doc.registerFont('DejaVu', FONT_PATH)
  doc.font('DejaVu')

  const chunks: Buffer[] = []
  doc.on('data', (chunk: Buffer) => chunks.push(chunk))
  const done = new Promise<Buffer>((resolvePromise, reject) => {
    doc.on('end', () => resolvePromise(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  const width = doc.page.width - 96
  const line = (text: string, size = 10, color = '#334155') => {
    doc.fillColor(color).fontSize(size).text(text, { width })
  }
  const row = (left: string, right: string, size = 10, color = '#0f172a') => {
    const y = doc.y
    doc.fillColor(color).fontSize(size).text(left, 48, y, { width: width - 150 })
    doc.text(right, doc.page.width - 48 - 140, y, { width: 140, align: 'right' })
    doc.moveDown(0.45)
  }
  const rule = () => {
    doc.moveDown(0.3)
    doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(48, doc.y).lineTo(doc.page.width - 48, doc.y).stroke()
    doc.moveDown(0.6)
  }

  doc.fillColor('#1d4ed8').fontSize(10).text('ITADIS · ФИНАНСОВЫЙ ДОКУМЕНТ', { width })
  doc.moveDown(0.3)
  doc.fillColor('#0f172a').fontSize(22).text(`Счёт ${card.number}`, { width })
  doc.moveDown(0.2)
  doc.fillColor('#64748b').fontSize(10).text(`Сформирован ${new Date().toLocaleString('ru-RU')} · ${CURRENCY}`, { width })
  doc.moveDown(1)

  row('Статус', INVOICE_STATUS_LABELS[card.status] ?? card.status, 11)
  row('Дата выставления', card.createdAt.toLocaleDateString('ru-RU'))
  row('Срок оплаты', card.dueAt.toLocaleDateString('ru-RU'))
  if (card.periodMonth) row('Период начисления', card.periodMonth)
  rule()

  line('ПЛАТЕЛЬЩИК', 9, '#64748b')
  doc.moveDown(0.25)
  line(card.student.name, 12)
  line(card.student.email, 9, '#64748b')
  if (card.student.phone) line(card.student.phone, 9, '#64748b')
  doc.moveDown(0.8)

  line('УСЛУГА', 9, '#64748b')
  doc.moveDown(0.25)
  line(card.description, 11)
  if (card.course) line(`Курс: ${card.course.title}`, 10, '#475569')
  rule()

  line('ПЛАТЕЖИ', 9, '#64748b')
  doc.moveDown(0.35)
  if (card.payments.length === 0) {
    line('Платежей пока нет.', 10, '#64748b')
  } else {
    for (const payment of card.payments.slice(0, 18)) {
      row(
        `${payment.paidAt.toLocaleDateString('ru-RU')} · ${PAYMENT_METHOD_LABELS[payment.method] ?? payment.method} · ${PAYMENT_STATUS_LABELS[payment.status] ?? payment.status}`,
        `${payment.amount} ${CURRENCY}`,
        9,
      )
    }
    if (card.payments.length > 18) line(`Ещё платежей: ${card.payments.length - 18} — см. историю в кабинете.`, 9, '#64748b')
  }
  rule()

  if (card.discountAmount > 0) {
    row('Скидка', `−${card.discountAmount} ${CURRENCY}`, 10, '#047857')
    for (const discount of card.discounts.slice(0, 5)) line(`• ${discount.reason} (${discount.createdBy})`, 9, '#64748b')
    doc.moveDown(0.5)
  }
  row('Начислено', `${card.grossAmount} ${CURRENCY}`)
  row('Оплачено', `${card.totals.received - card.totals.refunded} ${CURRENCY}`)
  row('Возвращено', `${card.totals.refunded} ${CURRENCY}`)
  doc.moveDown(0.3)
  row('К ОПЛАТЕ', `${card.totals.remaining} ${CURRENCY}`, 14, '#1d4ed8')

  doc.moveDown(1.2)
  line('Документ сформирован системой ITadis и является внутренней квитанцией об оплате обучения.', 8, '#94a3b8')
  line('Фискальный чек выдаёт платёжный или налоговый сервис филиала. IT Coins не являются денежными средствами.', 8, '#94a3b8')

  doc.end()
  return done
}
