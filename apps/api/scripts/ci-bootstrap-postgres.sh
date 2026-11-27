#!/usr/bin/env bash
# Пять сценариев bootstrap администратора на реальном PostgreSQL.
#
# Запускается в CI (.github/workflows/ci.yml, job bootstrap-postgres) и локально:
#
#   DATABASE_URL=postgresql://itadis:itadis@127.0.0.1:5432/itadis \
#     bash scripts/ci-bootstrap-postgres.sh
#
# Требования: применённые миграции (`npx prisma migrate deploy`), собранный
# `dist/src/bootstrap.js` (`npm run build`), клиент psql.
#
# Сценарии проверяют не только вывод CLI, но и состояние таблиц до/после через
# SQL: количество пользователей, роль, isActive и хеш пароля. Поэтому «команда
# сказала created» без реальной строки в БД здесь не пройдёт.
set -euo pipefail

cd -- "$(dirname -- "$0")/.."

: "${DATABASE_URL:?DATABASE_URL не задан}"
command -v psql >/dev/null 2>&1 || {
  echo 'нужен psql (postgresql-client)' >&2
  exit 2
}
[[ -f dist/src/bootstrap.js ]] || {
  echo 'нет dist/src/bootstrap.js: сначала npm run build' >&2
  exit 2
}

# Параметр ?schema=public понимает Prisma, а libpq на незнакомый параметр
# отвечает ошибкой — для psql строку подключения обрезаем.
DB_URL=${DATABASE_URL%%\?*}
PSQL=(psql "$DB_URL" -v ON_ERROR_STOP=1 -tAq)

PASSWORD='ci-bootstrap-password-0123456789'
ROTATED='ci-bootstrap-password-rotated-9876543210'
STUDENT_PASSWORD='ci-existing-student-password-1234'
FAILED=0
LOG=$(mktemp)
trap 'rm -f -- "$LOG"' EXIT

sql() { "${PSQL[@]}" -c "$1"; }

pass() { printf '  PASS %s\n' "$1"; }
fail() {
  printf '  FAIL %s: %s\n' "$1" "$2" >&2
  FAILED=1
}

expect() { # <имя> <ожидаемое> <фактическое>
  if [[ $3 == "$2" ]]; then
    pass "$1"
  else
    fail "$1" "ожидалось '$2', получено '$3'"
  fi
}

expect_in_log() { # <имя> <регэксп>
  if grep -qE -- "$2" "$LOG"; then
    pass "$1"
  else
    fail "$1" "в выводе нет /$2/: $(tr '\n' ' ' <"$LOG")"
  fi
}

# bcrypt_matches <хеш> <пароль>
bcrypt_matches() {
  HASH=$1 PLAIN=$2 node --input-type=module -e '
    import bcrypt from "bcryptjs"
    const { HASH, PLAIN } = process.env
    try {
      process.exit((await bcrypt.compare(PLAIN, HASH)) ? 0 : 1)
    } catch {
      process.exit(1)
    }
  ' >/dev/null 2>&1
}

# run_bootstrap <email> <пароль> <хеш>
run_bootstrap() {
  PLATFORM_ADMIN_EMAIL=$1 \
    PLATFORM_ADMIN_PASSWORD=${2:-} \
    PLATFORM_ADMIN_PASSWORD_HASH=${3:-} \
    NODE_ENV=production \
    node dist/src/bootstrap.js
}

hash_of() { # <email> — хеш пароля из БД
  sql "SELECT \"passwordHash\" FROM \"User\" WHERE email = '$1'"
}

role_of() { # <email>
  sql "SELECT role FROM \"User\" WHERE email = '$1'"
}

active_of() { # <email>
  sql "SELECT \"isActive\" FROM \"User\" WHERE email = '$1'"
}

user_count() { # <email>
  sql "SELECT count(*) FROM \"User\" WHERE email = '$1'"
}

bcrypt_hash() { # <пароль>
  PLAIN=$1 node --input-type=module -e '
    import bcrypt from "bcryptjs"
    process.stdout.write(await bcrypt.hash(process.env.PLAIN, 10))
  '
}

echo '== 1. Чистая БД: создаётся ровно один ADMIN с рабочим паролем =='
expect 'до запуска пользователей нет' '0' "$(sql 'SELECT count(*) FROM "User"')"
if run_bootstrap bootstrap@example.com "$PASSWORD" >"$LOG" 2>&1; then
  pass 'bootstrap завершился с кодом 0'
else
  fail 'bootstrap завершился с кодом 0' "$(tr '\n' ' ' <"$LOG")"
fi
expect_in_log 'в логе action created' '→ created'
expect 'в БД ровно один пользователь' '1' "$(user_count bootstrap@example.com)"
expect 'роль пользователя ADMIN' 'ADMIN' "$(role_of bootstrap@example.com)"
expect 'пользователь активен' 't' "$(active_of bootstrap@example.com)"
expect 'хеш bcrypt длиной 60' '60' "$(sql 'SELECT length("passwordHash") FROM "User" WHERE email = '\''bootstrap@example.com'\''')"
if bcrypt_matches "$(hash_of bootstrap@example.com)" "$PASSWORD"; then
  pass 'пароль совпадает с сохранённым хешем'
else
  fail 'пароль совпадает с сохранённым хешем' 'bcrypt.compare вернул false'
fi
GRANTS=$(sql "SELECT count(*) FROM \"RolePermission\" WHERE role = 'ADMIN'")
PERMISSIONS=$(sql 'SELECT count(*) FROM "Permission"')
expect 'ADMIN получил все права каталога' "$PERMISSIONS" "$GRANTS"

echo '== 2. Повторный запуск с тем же паролем идемпотентен =='
HASH_BEFORE=$(hash_of bootstrap@example.com)
if run_bootstrap bootstrap@example.com "$PASSWORD" >"$LOG" 2>&1; then
  pass 'повторный bootstrap завершился с кодом 0'
else
  fail 'повторный bootstrap завершился с кодом 0' "$(tr '\n' ' ' <"$LOG")"
fi
expect_in_log 'в логе action unchanged' '→ unchanged'
expect 'второй пользователь не создан' '1' "$(user_count bootstrap@example.com)"
expect 'хеш пароля не перезаписан' "$HASH_BEFORE" "$(hash_of bootstrap@example.com)"

echo '== 3. Смена пароля обновляет хеш, старый пароль перестаёт работать =='
if run_bootstrap bootstrap@example.com "$ROTATED" >"$LOG" 2>&1; then
  pass 'bootstrap с новым паролем завершился с кодом 0'
else
  fail 'bootstrap с новым паролем завершился с кодом 0' "$(tr '\n' ' ' <"$LOG")"
fi
expect_in_log 'в логе action password-updated' '→ password-updated'
expect 'пользователь по-прежнему один' '1' "$(user_count bootstrap@example.com)"
if bcrypt_matches "$(hash_of bootstrap@example.com)" "$ROTATED"; then
  pass 'новый пароль совпадает с хешем'
else
  fail 'новый пароль совпадает с хешем' 'bcrypt.compare вернул false'
fi
if bcrypt_matches "$(hash_of bootstrap@example.com)" "$PASSWORD"; then
  fail 'старый пароль перестал работать' 'bcrypt.compare со старым паролем вернул true'
else
  pass 'старый пароль перестал работать'
fi

echo '== 4. Существующий не-ADMIN не повышается молча =='
STUDENT_HASH=$(bcrypt_hash "$STUDENT_PASSWORD")
sql "INSERT INTO \"User\" (id, email, \"passwordHash\", \"firstName\", \"lastName\", role, \"isActive\", \"createdAt\", \"updatedAt\") VALUES ('00000000-0000-0000-0000-000000000123', 'existing-student@example.com', '$STUDENT_HASH', 'Existing', 'Student', 'STUDENT', false, now(), now())"
expect 'до запуска роль STUDENT' 'STUDENT' "$(role_of existing-student@example.com)"
if run_bootstrap existing-student@example.com "$PASSWORD" >"$LOG" 2>&1; then
  fail 'bootstrap отказался менять чужую роль' 'код возврата 0'
else
  pass 'bootstrap отказался менять чужую роль (код 1)'
fi
expect_in_log 'в ошибке названа текущая роль' 'с ролью STUDENT'
expect_in_log 'в ошибке объяснён отказ' 'не меняет роль существующих пользователей'
expect 'роль осталась STUDENT' 'STUDENT' "$(role_of existing-student@example.com)"
expect 'пароль не перезаписан' "$STUDENT_HASH" "$(hash_of existing-student@example.com)"
expect 'учётная запись не реактивирована' 'f' "$(active_of existing-student@example.com)"
expect 'пользователь не задублирован' '1' "$(user_count existing-student@example.com)"

echo '== 5. Готовый bcrypt-хеш принимается как есть, cost вне 04–31 отклоняется =='
PRECOMPUTED=$(bcrypt_hash "$PASSWORD")
if run_bootstrap hash-admin@example.com '' "$PRECOMPUTED" >"$LOG" 2>&1; then
  pass 'bootstrap с PLATFORM_ADMIN_PASSWORD_HASH завершился с кодом 0'
else
  fail 'bootstrap с PLATFORM_ADMIN_PASSWORD_HASH завершился с кодом 0' "$(tr '\n' ' ' <"$LOG")"
fi
expect_in_log 'в логе action created' '→ created'
expect 'хеш сохранён без повторного хеширования' "$PRECOMPUTED" "$(hash_of hash-admin@example.com)"
if bcrypt_matches "$(hash_of hash-admin@example.com)" "$PASSWORD"; then
  pass 'пароль совпадает с готовым хешем'
else
  fail 'пароль совпадает с готовым хешем' 'bcrypt.compare вернул false'
fi

BAD_LOW="\$2b\$03\$$(printf 'a%.0s' $(seq 1 53))"
if run_bootstrap bad-cost-low@example.com '' "$BAD_LOW" >"$LOG" 2>&1; then
  fail 'хеш с cost 03 отклонён' 'код возврата 0'
else
  pass 'хеш с cost 03 отклонён (код 1)'
fi
expect_in_log 'в ошибке упомянут bcrypt' 'bcrypt'
expect 'пользователь с неверным хешем не создан' '0' "$(user_count bad-cost-low@example.com)"

BAD_HIGH="\$2b\$32\$$(printf 'a%.0s' $(seq 1 53))"
if run_bootstrap bad-cost-high@example.com '' "$BAD_HIGH" >"$LOG" 2>&1; then
  fail 'хеш с cost 32 отклонён' 'код возврата 0'
else
  pass 'хеш с cost 32 отклонён (код 1)'
fi
expect 'пользователь с cost 32 не создан' '0' "$(user_count bad-cost-high@example.com)"

echo
if ((FAILED)); then
  echo 'Bootstrap на PostgreSQL: есть провалы' >&2
  exit 1
fi
echo 'Bootstrap на PostgreSQL: все 5 сценариев прошли'
