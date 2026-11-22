import { CURRENCY } from './finance.calc.js'
import type { InvoiceCard } from './finance.mappers.js'
import {
  INVOICE_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  escapeHtml,
} from './finance.shared.js'

/**
 * Печатная квитанция: открывается в браузере и сохраняется в PDF через печать.
 * Все текстовые поля экранируются — данные ученика не должны ломать разметку.
 */
export function buildReceiptHtml(card: InvoiceCard): string {
  const paid = card.totals.received - card.totals.refunded

  const rows = card.payments
    .map(
      (payment) =>
        `<tr><td>${escapeHtml(payment.paidAt.toLocaleString('ru-RU'))}</td><td>${escapeHtml(
          PAYMENT_METHOD_LABELS[payment.method] ?? payment.method,
        )}</td><td class="num">${payment.amount} ${CURRENCY}</td><td>${escapeHtml(
          PAYMENT_STATUS_LABELS[payment.status] ?? payment.status,
        )}</td></tr>`,
    )
    .join('')

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Квитанция ${escapeHtml(card.number)}</title>
<style>
  body{font-family:'Segoe UI',system-ui,sans-serif;color:#0f172a;margin:0;padding:32px;background:#f5f7fb}
  .sheet{max-width:760px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:32px}
  h1{font-size:22px;margin:0 0 4px} .muted{color:#6b7280;font-size:13px}
  table{width:100%;border-collapse:collapse;margin-top:18px;font-size:14px}
  th,td{text-align:left;padding:9px 10px;border-bottom:1px solid #e5e7eb}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .totals{margin-top:20px;display:flex;flex-direction:column;gap:6px;align-items:flex-end;font-size:14px}
  .totals strong{font-size:18px}
  .print{margin-top:24px}
  @media print{body{background:#fff;padding:0}.sheet{border:none;padding:0}.print{display:none}}
</style></head>
<body><div class="sheet">
  <h1>Счёт ${escapeHtml(card.number)}</h1>
  <p class="muted">ITadis · счёт за обучение от ${card.createdAt.toLocaleDateString('ru-RU')}</p>
  <p><strong>Ученик:</strong> ${escapeHtml(card.student.name)}<br>
  <strong>Услуга:</strong> ${escapeHtml(card.description)}<br>
  ${card.course ? `<strong>Курс:</strong> ${escapeHtml(card.course.title)}<br>` : ''}
  <strong>Срок оплаты:</strong> ${card.dueAt.toLocaleDateString('ru-RU')}<br>
  <strong>Статус:</strong> ${escapeHtml(INVOICE_STATUS_LABELS[card.status] ?? card.status)}</p>
  <table><thead><tr><th>Дата</th><th>Способ</th><th class="num">Сумма</th><th>Статус</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="4" class="muted">Платежей пока нет</td></tr>'}</tbody></table>
  <div class="totals">
    <span>Начислено: ${card.amount} ${CURRENCY}</span>
    <span>Оплачено: ${paid} ${CURRENCY}</span>
    <span>Возвращено: ${card.totals.refunded} ${CURRENCY}</span>
    <strong>К оплате: ${card.totals.remaining} ${CURRENCY}</strong>
  </div>
  <p class="muted">Документ сформирован системой ITadis. Это внутренняя квитанция об оплате обучения,
  а не фискальный чек; фискальный документ выдаёт платёжный или налоговый сервис филиала.</p>
  <button class="button print" onclick="window.print()">Сохранить в PDF</button>
</div></body></html>`
}
