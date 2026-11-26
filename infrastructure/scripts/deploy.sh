#!/usr/bin/env bash
# Деплой production ITadis одной командой.
#
#   infrastructure/scripts/deploy.sh --ip 203.0.113.10
#
# Скрипт считает PUBLIC_HOSTNAME из IP сервера (203.0.113.10 → 203-0-113-10.sslip.io),
# проверяет обязательные переменные в .env.production и свободность портов 80/443,
# затем поднимает docker-compose.prod.yml и ждёт ответа https://PUBLIC_HOSTNAME/healthz.
#
# Секреты не печатаются: скрипт сообщает только имена незаполненных переменных.
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/../.." && pwd)
COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE="$REPO_ROOT/.env.production"
SERVER_IP=""
CHECK_ONLY=0
HEALTH_TIMEOUT=${DEPLOY_HEALTH_TIMEOUT:-600}

# Переменные, без которых compose падает до старта (`:?` в compose) или не
# выпускается сертификат Let's Encrypt.
REQUIRED_VARS=(
  POSTGRES_PASSWORD
  JWT_ACCESS_SECRET
  JWT_REFRESH_SECRET
  DATA_ENCRYPTION_KEY
  APP_ORIGIN
  S3_ACCESS_KEY
  S3_SECRET_KEY
  ACME_EMAIL
)
# Секреты короче 32 символов пропускаются, но это признак плейсхолдера.
LONG_SECRETS=(JWT_ACCESS_SECRET JWT_REFRESH_SECRET DATA_ENCRYPTION_KEY POSTGRES_PASSWORD)

if [[ -t 1 ]]; then
  C_RESET=$'\033[0m' C_INFO=$'\033[36m' C_OK=$'\033[32m' C_WARN=$'\033[33m' C_ERR=$'\033[31m'
else
  C_RESET='' C_INFO='' C_OK='' C_WARN='' C_ERR=''
fi

info() { printf '%s==>%s %s\n' "$C_INFO" "$C_RESET" "$*"; }
ok() { printf '%s  ✓%s %s\n' "$C_OK" "$C_RESET" "$*"; }
warn() { printf '%s  !%s %s\n' "$C_WARN" "$C_RESET" "$*" >&2; }
die() {
  printf '%sОшибка:%s %s\n' "$C_ERR" "$C_RESET" "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Использование: infrastructure/scripts/deploy.sh [опции]

  --ip IP           публичный IPv4 сервера. Из него считается PUBLIC_HOSTNAME
                    (203.0.113.10 → 203-0-113-10.sslip.io) и записывается в .env.production.
                    Без флага берётся из PUBLIC_HOSTNAME, иначе определяется автоматически.
  --env-file FILE   файл переменных, по умолчанию .env.production в корне репозитория.
  --check           только preflight: переменные и порты, compose не запускать.
  -h, --help        эта справка.

Примеры:
  infrastructure/scripts/deploy.sh --ip 203.0.113.10   # полный деплой
  infrastructure/scripts/deploy.sh --check             # проверить готовность сервера
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ip)
      [[ $# -ge 2 ]] || die "--ip требует значение"
      SERVER_IP=$2
      shift 2
      ;;
    --ip=*)
      SERVER_IP=${1#*=}
      shift
      ;;
    --env-file)
      [[ $# -ge 2 ]] || die "--env-file требует путь"
      ENV_FILE=$2
      shift 2
      ;;
    --env-file=*)
      ENV_FILE=${1#*=}
      shift
      ;;
    --check)
      CHECK_ONLY=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      die "неизвестный аргумент: $1 (см. --help)"
      ;;
  esac
done

cd -- "$REPO_ROOT"

# --- значения из .env.production -------------------------------------------------

env_value() {
  local key=$1 line value=''
  [[ -f $ENV_FILE ]] || return 0
  while IFS= read -r line || [[ -n $line ]]; do
    line=${line%$'\r'}
    [[ $line =~ ^[[:space:]]*(export[[:space:]]+)?${key}= ]] || continue
    value=${line#*=}
  done <"$ENV_FILE"
  if [[ $value == \"*\" || $value == \'*\' ]]; then
    value=${value:1:$((${#value} - 2))}
  fi
  printf '%s' "$value"
}

set_env_value() {
  local key=$1 value=$2 tmp
  if grep -qE "^[[:space:]]*(export[[:space:]]+)?${key}=" "$ENV_FILE"; then
    tmp=$(mktemp)
    awk -v key="$key" -v value="$value" '
      $0 ~ "^[[:space:]]*(export[[:space:]]+)?" key "=" && !done {
        print key "=" value
        done = 1
        next
      }
      { print }
    ' "$ENV_FILE" >"$tmp"
    cat -- "$tmp" >"$ENV_FILE"
    rm -f -- "$tmp"
  else
    [[ -s $ENV_FILE && $(tail -c 1 "$ENV_FILE") != $'\n' ]] && printf '\n' >>"$ENV_FILE"
    printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
  fi
}

is_ipv4() { [[ $1 =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; }

detect_public_ip() {
  local url ip
  for url in https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com; do
    ip=$(curl -fsS --max-time 5 "$url" 2>/dev/null | tr -d '[:space:]') || continue
    if is_ipv4 "$ip"; then
      printf '%s' "$ip"
      return 0
    fi
  done
  return 1
}

port_in_use() { # <tcp|udp> <port>; 0 — занят, 1 — свободен, 2 — проверить нечем
  local proto=$1 port=$2 listing
  if command -v ss >/dev/null 2>&1; then
    if [[ $proto == udp ]]; then listing=$(ss -H -lun 2>/dev/null || true); else listing=$(ss -H -ltn 2>/dev/null || true); fi
  elif command -v netstat >/dev/null 2>&1; then
    if [[ $proto == udp ]]; then listing=$(netstat -lun 2>/dev/null || true); else listing=$(netstat -ltn 2>/dev/null || true); fi
  else
    return 2
  fi
  awk -v port=":$port" 'index($4, port) == length($4) - length(port) + 1 { found = 1 } END { exit !found }' <<<"$listing"
}

port_owner_container() { # <port> — имя контейнера, который публикует порт
  docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null |
    awk -v p=":$1->" 'index($0, p) { print $1; exit }'
}

# --- preflight -------------------------------------------------------------------

info "Preflight для $COMPOSE_FILE (env: ${ENV_FILE#"$REPO_ROOT"/})"

command -v docker >/dev/null 2>&1 || die "docker не найден. Установите Docker Engine и compose-плагин."
docker compose version >/dev/null 2>&1 || die "\`docker compose\` (v2) недоступен. Установите compose-плагин."
docker info >/dev/null 2>&1 || die "docker-демон недоступен: нет прав ($(id -un) не в группе docker?) или он не запущен."

if [[ ! -f $ENV_FILE ]]; then
  die "нет $(basename "$ENV_FILE"). Создайте его: cp .env.production.example $(basename "$ENV_FILE") и заполните секреты."
fi
ok "$(basename "$ENV_FILE") найден"

# PUBLIC_HOSTNAME: --ip > существующее значение > автоопределение.
CURRENT_HOSTNAME=$(env_value PUBLIC_HOSTNAME)
if [[ -n $SERVER_IP ]]; then
  is_ipv4 "$SERVER_IP" || die "--ip должен быть IPv4, получено: $SERVER_IP"
elif [[ $CURRENT_HOSTNAME =~ ^([0-9]{1,3}-){3}[0-9]{1,3}\.sslip\.io$ ]]; then
  SERVER_IP=${CURRENT_HOSTNAME%.sslip.io}
  SERVER_IP=${SERVER_IP//-/.}
elif [[ -n $CURRENT_HOSTNAME ]]; then
  SERVER_IP=''
else
  info "IP не задан, определяю публичный адрес сервера"
  SERVER_IP=$(detect_public_ip) || die "не удалось определить IP: укажите --ip <IPv4>"
fi

if [[ -n $SERVER_IP ]] && is_ipv4 "$SERVER_IP"; then
  PUBLIC_HOSTNAME="${SERVER_IP//./-}.sslip.io"
else
  PUBLIC_HOSTNAME=$CURRENT_HOSTNAME
fi
[[ -n $PUBLIC_HOSTNAME ]] || die "не удалось вычислить PUBLIC_HOSTNAME: укажите --ip <IPv4>"

if [[ $(env_value PUBLIC_HOSTNAME) != "$PUBLIC_HOSTNAME" ]]; then
  set_env_value PUBLIC_HOSTNAME "$PUBLIC_HOSTNAME"
  ok "PUBLIC_HOSTNAME=$PUBLIC_HOSTNAME записан в $(basename "$ENV_FILE")"
else
  ok "PUBLIC_HOSTNAME=$PUBLIC_HOSTNAME"
fi

MISSING=()
for key in "${REQUIRED_VARS[@]}"; do
  [[ -n $(env_value "$key") ]] || MISSING+=("$key")
done
if ((${#MISSING[@]})); then
  printf 'Не заполнены обязательные переменные в %s:\n' "$(basename "$ENV_FILE")" >&2
  printf '  - %s\n' "${MISSING[@]}" >&2
  die "заполните их в $(basename "$ENV_FILE") (шаблон: .env.production.example) и запустите снова"
fi
ok "обязательные переменные заполнены: ${REQUIRED_VARS[*]}"

for key in "${LONG_SECRETS[@]}"; do
  value=$(env_value "$key")
  ((${#value} >= 32)) || warn "$key короче 32 символов — похоже на плейсхолдер"
done

APP_ORIGIN_VALUE=$(env_value APP_ORIGIN)
if [[ $APP_ORIGIN_VALUE != "https://$PUBLIC_HOSTNAME" ]]; then
  warn "APP_ORIGIN=$APP_ORIGIN_VALUE не совпадает с https://$PUBLIC_HOSTNAME (нормально при своём домене)"
fi
[[ -n $(env_value PRIMARY_DOMAIN) ]] || warn "PRIMARY_DOMAIN пуст: основной сайт ответит 404 при ALLOW_PRIMARY_FALLBACK=false"
[[ -n $(env_value PLATFORM_ADMIN_EMAIL) ]] || warn "PLATFORM_ADMIN_EMAIL пуст: войти в платформенную админку будет некому"
PLATFORM_ADMIN_PASSWORD_VALUE=$(env_value PLATFORM_ADMIN_PASSWORD)
if [[ -z $PLATFORM_ADMIN_PASSWORD_VALUE && -z $(env_value PLATFORM_ADMIN_PASSWORD_HASH) ]]; then
  warn "PLATFORM_ADMIN_PASSWORD и PLATFORM_ADMIN_PASSWORD_HASH пусты: сервис bootstrap не создаст администратора"
elif [[ -n $PLATFORM_ADMIN_PASSWORD_VALUE && ${#PLATFORM_ADMIN_PASSWORD_VALUE} -lt 12 && -z $(env_value PLATFORM_ADMIN_PASSWORD_HASH) ]]; then
  # Порог тот же, что у bootstrap (apps/api/src/lib/bootstrap-admin.ts).
  warn "PLATFORM_ADMIN_PASSWORD короче 12 символов: bootstrap администратора откажется его применять"
fi
if [[ $(env_value ALLOW_PRIMARY_FALLBACK) == true ]]; then
  warn "ALLOW_PRIMARY_FALLBACK=true: для production ожидается false"
fi

ENV_MODE=$(stat -c '%a' "$ENV_FILE" 2>/dev/null || echo 600)
if ((8#$ENV_MODE & 077)); then
  warn "у $(basename "$ENV_FILE") права $ENV_MODE: секреты видны другим (chmod 600)"
fi

COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
"${COMPOSE[@]}" config --quiet || die "compose отклоняет конфигурацию: см. сообщение выше"

PROJECT=$(basename "$REPO_ROOT")
PORTS_OK=1
for spec in 'tcp 80' 'tcp 443' 'udp 443'; do
  read -r proto port <<<"$spec"
  set +e
  port_in_use "$proto" "$port"
  status=$?
  set -e
  case $status in
    0)
      owner=$(port_owner_container "$port" || true)
      if [[ -n $owner && ($owner == caddy* || $owner == "${PROJECT}"-*) ]]; then
        ok "порт $port/$proto уже слушает $owner (наш стек — передеплой)"
      else
        warn "порт $port/$proto занят${owner:+ контейнером $owner}; caddy не сможет занять его"
        PORTS_OK=0
      fi
      ;;
    1) ok "порт $port/$proto свободен" ;;
    2) warn "порт $port/$proto проверить нечем (нет ss/netstat)" ;;
  esac
done
((PORTS_OK)) || die "освободите порты 80/443 tcp и 443 udp, затем запустите снова"

if [[ $CHECK_ONLY -eq 1 ]]; then
  ok "preflight пройден (--check): https://$PUBLIC_HOSTNAME/healthz после запуска"
  exit 0
fi

# --- запуск ----------------------------------------------------------------------

info "Собираю и поднимаю стек: ${COMPOSE[*]} up -d --build"
"${COMPOSE[@]}" up -d --build

info "Жду https://$PUBLIC_HOSTNAME/healthz (до ${HEALTH_TIMEOUT}s; первый старт качает базы ClamAV)"
deadline=$(($(date +%s) + HEALTH_TIMEOUT))
while :; do
  if curl -fsS --max-time 10 "https://$PUBLIC_HOSTNAME/healthz" >/dev/null 2>&1; then
    ok "https://$PUBLIC_HOSTNAME/healthz отвечает"
    break
  fi
  if (($(date +%s) >= deadline)); then
    "${COMPOSE[@]}" ps || true
    die "healthz не ответил за ${HEALTH_TIMEOUT}s: смотрите \`${COMPOSE[*]} logs --tail=200 caddy backend\`"
  fi
  sleep 5
done

"${COMPOSE[@]}" ps

cat <<EOF

${C_OK}Деплой завершён.${C_RESET}
  Сайт:    https://$PUBLIC_HOSTNAME
  Health:  https://$PUBLIC_HOSTNAME/healthz
  API:     https://$PUBLIC_HOSTNAME/api

Осталось один раз: в настройках сайта Freebuff задайте API_ORIGIN=https://$PUBLIC_HOSTNAME,
чтобы форма заявок и вход на https://platform-it-adis-nmtovk.freebuff.site шли на этот сервер.

Администратор основной БД: ${COMPOSE[*]} logs bootstrap
EOF
