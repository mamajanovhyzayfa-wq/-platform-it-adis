import { describe, expect, it } from 'vitest'
import {
  databaseNameFor,
  generateAdminPassword,
  isValidDomain,
  isValidSlug,
  normalizeDomain,
  slugFromDomain,
  splitSqlStatements,
} from '../src/lib/branches.util.js'
import { databaseNameFromUrl } from '../src/lib/primary-branch.js'

describe('филиалы: домен и идентификаторы', () => {
  it('нормализует домен', () => {
    expect(normalizeDomain('  Filial.Example.COM. ')).toBe('filial.example.com')
  })

  it('принимает домены с поддоменами и отклоняет мусор', () => {
    expect(isValidDomain('filial.example.com')).toBe(true)
    expect(isValidDomain('demo.localhost')).toBe(true)
    expect(isValidDomain('example')).toBe(false)
    expect(isValidDomain('-bad.example.com')).toBe(false)
    expect(isValidDomain('bad_.example.com')).toBe(false)
    expect(isValidDomain('example.c')).toBe(false)
  })

  it('строит slug и имя отдельной базы', () => {
    expect(slugFromDomain('filial-oshi.itadis.kg')).toBe('filial-oshi')
    expect(databaseNameFor('filial-oshi', 'itadis_branch_')).toBe('itadis_branch_filial_oshi')
    expect(isValidSlug('filial-oshi')).toBe(true)
    expect(isValidSlug('-bad')).toBe(false)
    expect(isValidSlug('Bad_Slug')).toBe(false)
  })

  it('извлекает имя основной БД из DATABASE_URL', () => {
    expect(databaseNameFromUrl('postgresql://itadis:secret@localhost:5432/itadis?schema=public')).toBe('itadis')
    expect(databaseNameFromUrl('postgresql://itadis:secret@localhost:5432/')).toBe('primary')
  })

  it('выдаёт временный пароль с буквами разного регистра и цифрой', () => {
    const password = generateAdminPassword()
    expect(password).toMatch(/[a-z]/)
    expect(password).toMatch(/[A-Z]/)
    expect(password).toMatch(/\d/)
    expect(password.length).toBeGreaterThanOrEqual(10)
  })
})

describe('филиалы: SQL миграций', () => {
  it('делит файл миграции на отдельные операторы', () => {
    const statements = splitSqlStatements(`
      -- комментарий
      CREATE TABLE "A" ("id" TEXT);
      CREATE INDEX "A_id_idx" ON "A"("id");
    `)
    expect(statements).toHaveLength(2)
    expect(statements[0]).toContain('CREATE TABLE')
    expect(statements[1]).toContain('CREATE INDEX')
    expect(statements.every((statement) => statement.endsWith(';'))).toBe(true)
  })
})
