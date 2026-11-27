#!/usr/bin/env bats
# Проверки preflight `infrastructure/scripts/deploy.sh` без Docker и без сети.
#
# deploy.sh сначала требует docker/docker compose/docker info, поэтому в PATH
# подставляются заглушки docker и ss: они отвечают успехом и ничего не делают.
# Так проверяется логика самого скрипта (переменные, PUBLIC_HOSTNAME, отказы),
# а не docker. Реальный деплой эти тесты не выполняют.
#
#   bats infrastructure/tests/deploy.bats

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  DEPLOY="$REPO_ROOT/infrastructure/scripts/deploy.sh"
  ENV_FILE="$BATS_TEST_TMPDIR/production.env"
  FAKE_BIN="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$FAKE_BIN"

  # docker: любой вызов (compose version/info/config/ps) — успех без вывода.
  cat >"$FAKE_BIN/docker" <<'SH'
#!/usr/bin/env bash
exit 0
SH
  # ss: пустой список слушающих сокетов — порты 80/443/8080 считаются свободными.
  cat >"$FAKE_BIN/ss" <<'SH'
#!/usr/bin/env bash
exit 0
SH
  chmod +x "$FAKE_BIN/docker" "$FAKE_BIN/ss"
}

run_deploy() {
  run env PATH="$FAKE_BIN:$PATH" "$DEPLOY" --env-file "$ENV_FILE" "$@"
}

write_env() {
  cat >"$ENV_FILE" <<'EOF'
POSTGRES_USER=itadis
POSTGRES_DB=itadis
POSTGRES_PASSWORD=ci-postgres-password-value-0123456789
JWT_ACCESS_SECRET=ci-access-secret-value-0123456789abcdef
JWT_REFRESH_SECRET=ci-refresh-secret-value-0123456789abcdef
DATA_ENCRYPTION_KEY=ci-encryption-key-value-0123456789abcdef
APP_ORIGIN=https://203-0-113-10.sslip.io
PRIMARY_DOMAIN=203-0-113-10.sslip.io
PLATFORM_ADMIN_EMAIL=platform@example.com
PLATFORM_ADMIN_PASSWORD=ci-platform-admin-password
S3_ACCESS_KEY=ci-s3-access-key
S3_SECRET_KEY=ci-s3-secret-key-value-0123456789
ACME_EMAIL=ci@example.com
EOF
}

@test "deploy.sh --help печатает справку и выходит с кодом 0" {
  run_deploy --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Использование:"* ]]
  [[ "$output" == *"--check"* ]]
}

@test "deploy.sh отвергает неизвестный аргумент" {
  run_deploy --nope
  [ "$status" -eq 1 ]
  [[ "$output" == *"неизвестный аргумент"* ]]
}

@test "deploy.sh требует значение для --ip" {
  run_deploy --ip
  [ "$status" -eq 1 ]
  [[ "$output" == *"--ip требует значение"* ]]
}

@test "deploy.sh отвергает --ip не в формате IPv4" {
  write_env
  run_deploy --check --ip 203.0.113
  [ "$status" -eq 1 ]
  [[ "$output" == *"должен быть IPv4"* ]]
}

@test "deploy.sh без .env.production подсказывает шаблон" {
  run_deploy --check --ip 203.0.113.10
  [ "$status" -eq 1 ]
  [[ "$output" == *".env.production.example"* ]]
}

@test "deploy.sh --check проходит и записывает PUBLIC_HOSTNAME из --ip" {
  write_env
  run_deploy --check --ip 203.0.113.10
  [ "$status" -eq 0 ]
  [[ "$output" == *"preflight пройден"* ]]
  grep -q '^PUBLIC_HOSTNAME=203-0-113-10\.sslip\.io$' "$ENV_FILE"
}

@test "deploy.sh перечисляет все незаполненные обязательные переменные" {
  printf 'S3_ACCESS_KEY=only-this-one\n' >"$ENV_FILE"
  run_deploy --check --ip 203.0.113.10
  [ "$status" -eq 1 ]
  for key in POSTGRES_PASSWORD JWT_ACCESS_SECRET JWT_REFRESH_SECRET DATA_ENCRYPTION_KEY APP_ORIGIN S3_SECRET_KEY ACME_EMAIL; do
    [[ "$output" == *"  - $key"* ]]
  done
}

@test "deploy.sh не печатает значения секретов" {
  write_env
  run_deploy --check --ip 203.0.113.10
  [ "$status" -eq 0 ]
  [[ "$output" != *"ci-postgres-password-value-0123456789"* ]]
  [[ "$output" != *"ci-access-secret-value-0123456789abcdef"* ]]
  [[ "$output" != *"ci-platform-admin-password"* ]]
}

@test "deploy.sh предупреждает о коротком пароле администратора" {
  write_env
  sed -i 's/^PLATFORM_ADMIN_PASSWORD=.*/PLATFORM_ADMIN_PASSWORD=short/' "$ENV_FILE"
  run_deploy --check --ip 203.0.113.10
  [ "$status" -eq 0 ]
  [[ "$output" == *"PLATFORM_ADMIN_PASSWORD короче 12 символов"* ]]
}

@test "deploy.sh предупреждает о fallback и пустом администраторе платформы" {
  write_env
  printf 'ALLOW_PRIMARY_FALLBACK=true\nPLATFORM_ADMIN_EMAIL=\nPLATFORM_ADMIN_PASSWORD=\n' >>"$ENV_FILE"
  run_deploy --check --ip 203.0.113.10
  [ "$status" -eq 0 ]
  [[ "$output" == *"ALLOW_PRIMARY_FALLBACK=true"* ]]
  [[ "$output" == *"PLATFORM_ADMIN_EMAIL пуст"* ]]
  [[ "$output" == *"сервис bootstrap не создаст администратора"* ]]
}

@test "deploy.sh сохраняет PUBLIC_HOSTNAME из .env.production без --ip" {
  write_env
  printf 'PUBLIC_HOSTNAME=198-51-100-7.sslip.io\n' >>"$ENV_FILE"
  run_deploy --check
  [ "$status" -eq 0 ]
  [[ "$output" == *"PUBLIC_HOSTNAME=198-51-100-7.sslip.io"* ]]
  grep -q '^PUBLIC_HOSTNAME=198-51-100-7\.sslip\.io$' "$ENV_FILE"
}
