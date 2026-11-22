import { randomBytes } from 'node:crypto'

const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

export function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '')
}

export function isValidDomain(value: string): boolean {
  const domain = normalizeDomain(value)
  if (domain.length < 3 || domain.length > 253) return false
  const labels = domain.split('.')
  if (labels.length < 2) return false
  if (!labels.every((label) => DOMAIN_LABEL.test(label))) return false
  const tld = labels[labels.length - 1] ?? ''
  return /^[a-z]{2,}$/.test(tld)
}

export function slugFromDomain(domain: string): string {
  const first = normalizeDomain(domain).split('.')[0] ?? ''
  const slug = first
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return slug || 'branch'
}

export function isValidSlug(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(value)
}

export function databaseNameFor(slug: string, prefix: string): string {
  const name = `${prefix}${slug.replace(/-/g, '_')}`.toLowerCase()
  return name.slice(0, 63)
}

/**
 * Разбивает SQL миграции на отдельные операторы: Prisma не выполняет несколько
 * операторов в одном вызове. В миграциях проекта нет функций и dollar-quoting,
 * поэтому достаточно делить по `;`.
 */
export function splitSqlStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && !/^--[^\n]*$/.test(statement))
    .map((statement) => `${statement};`)
}

/** Временный пароль администратора филиала: выдаётся один раз при создании. */
export function generateAdminPassword(): string {
  return `Itadis-${randomBytes(8).toString('hex')}-A9`
}
