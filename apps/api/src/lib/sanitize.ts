/**
 * Санитизация текстовых полей публичных форм.
 *
 * Заявка с лендинга сохраняется в БД и уходит в CRM, выгрузки и уведомления.
 * HTML-теги и управляющие символы в таких полях не нужны, поэтому удаляются
 * до записи: `<script>alert(1)</script>Иван` превращается в `Иван`, а не
 * хранится как разметка.
 */

/** Содержимое script/style удаляется вместе с тегами, а не остаётся текстом. */
const SCRIPT_OR_STYLE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi
/** Остальные теги и угловые скобки, которые браузер мог бы принять за разметку. */
const HTML_TAGS = /<\/?[a-z][^>]*>/gi
const ANGLE_BRACKETS = /[<>]/g
/** Управляющие символы, кроме перевода строки и табуляции. */
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

/** Убирает разметку и управляющие символы, оставляя обычный текст в одну строку. */
export function sanitizePlainText(value: string): string {
  return value
    .replace(SCRIPT_OR_STYLE, ' ')
    .replace(HTML_TAGS, ' ')
    .replace(ANGLE_BRACKETS, '')
    .replace(CONTROL_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
}
