#!/usr/bin/env bash
# Smoke-проверка живого стека ITadis через публичный вход
# (caddy → edge → admin → backend).
#
#   infrastructure/scripts/smoke.sh https://203-0-113-10.sslip.io
#
# Проверяет:
#   GET  /healthz                            → 200 и "status":"ok"
#   POST /api/leads (без токена)             → 200/201, заявка создаётся
#   POST /api/leads с Origin сайта           → Access-Control-Allow-Origin равен Origin
#   GET  /api/platform/branches (без токена) → 401
#   GET  /socket.io/?EIO=4&transport=polling → 200 и engine.io handshake
#
# POST /api/leads создаёт одну настоящую заявку «Smoke test» — это ожидаемо;
# CORS проверяется на том же ответе, второй запрос не нужен.
# Секреты не нужны: все запросы анонимные. Проверка 401 идёт на
# /api/platform/branches, потому что этот путь не зависит от филиала
# (tenant middleware пропускает /api/platform по Host).
set -euo pipefail

BASE_URL=""
ORIGIN=${SMOKE_ORIGIN:-}
TIMEOUT=${SMOKE_TIMEOUT:-10}
TMP_DIR=$(mktemp -d)
trap 'rm -rf -- "$TMP_DIR"' EXIT

if [[ -t 1 ]]; then
  C_RESET=$'\033[0m' C_OK=$'\033[32m' C_ERR=$'\033[31m' C_WARN=$'\033[33m'
else
  C_RESET='' C_OK='' C_ERR='' C_WARN=''
fi

usage() {
  cat <<'EOF'
Использование: infrastructure/scripts/smoke.sh <base-url> [--origin URL] [--timeout СЕКУНД]

  <base-url>        публичный адрес стека: https://203-0-113-10.sslip.io
  --origin URL      origin сайта, с которого уходят заявки
                    (https://platform-it-adis-nmtovk.freebuff.site). За воркером
                    сайта Host и Origin расходятся, поэтому CORS проверяется
                    отдельно. Без флага проверка CORS будет пропущена.
  --timeout N       таймаут одного запроса, по умолчанию 10 (env: SMOKE_TIMEOUT)
  -h, --help        эта справка

Код возврата: 0 — все проверки прошли, 1 — есть провалы, 2 — неверный вызов.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h | --help)
      usage
      exit 0
      ;;
    --origin)
      [[ $# -ge 2 ]] || { echo "--origin требует URL" >&2; exit 2; }
      ORIGIN=$2
      shift 2
      ;;
    --origin=*)
      ORIGIN=${1#*=}
      shift
      ;;
    --timeout)
      [[ $# -ge 2 ]] || { echo "--timeout требует значение" >&2; exit 2; }
      TIMEOUT=$2
      shift 2
      ;;
    --timeout=*)
      TIMEOUT=${1#*=}
      shift
      ;;
    -*)
      echo "неизвестная опция: $1 (см. --help)" >&2
      exit 2
      ;;
    *)
      [[ -z $BASE_URL ]] || { echo "лишний аргумент: $1" >&2; exit 2; }
      BASE_URL=$1
      shift
      ;;
  esac
done

if [[ -z $BASE_URL ]]; then
  echo "нужен адрес стека, например: infrastructure/scripts/smoke.sh https://203-0-113-10.sslip.io" >&2
  exit 2
fi
command -v curl >/dev/null 2>&1 || { echo "нужен curl" >&2; exit 2; }

BASE_URL=${BASE_URL%/}
ORIGIN=${ORIGIN%/}
BODY_FILE="$TMP_DIR/body"
HEADER_FILE="$TMP_DIR/headers"
ERR_FILE="$TMP_DIR/err"
STATUS=""
PASSED=0
FAILED=0
SKIPPED=0

ok() { printf '  %sPASS%s %s\n' "$C_OK" "$C_RESET" "$*"; PASSED=$((PASSED + 1)); }
fail() {
  printf '  %sFAIL%s %s\n' "$C_ERR" "$C_RESET" "$*" >&2
  FAILED=$((FAILED + 1))
}
skip() { printf '  %sSKIP%s %s\n' "$C_WARN" "$C_RESET" "$*"; SKIPPED=$((SKIPPED + 1)); }

header_value() { # <имя заголовка> — последнее значение из ответа, без \r
  grep -i "^$1:" "$HEADER_FILE" 2>/dev/null | tail -1 | tr -d '\r' |
    sed 's/^[^:]*:[[:space:]]*//'
}

show_body() {
  local text
  text=$(head -c 300 "$BODY_FILE" 2>/dev/null | tr '\n' ' ')
  [[ -z $text ]] || printf '    ответ: %s\n' "$text" >&2
}

# http <метод> <путь> [аргументы curl...] — заполняет STATUS и BODY_FILE.
http() {
  local method=$1 path=$2
  shift 2
  : >"$BODY_FILE"
  : >"$HEADER_FILE"
  if ! STATUS=$(curl -sS --max-time "$TIMEOUT" -X "$method" -D "$HEADER_FILE" -o "$BODY_FILE" -w '%{http_code}' \
    "$@" "$BASE_URL$path" 2>"$ERR_FILE"); then
    STATUS=000
    printf '    %s\n' "$(tr '\n' ' ' <"$ERR_FILE" | sed 's/^curl: //')" >&2
  fi
}

check_health() {
  http GET /healthz
  if [[ $STATUS != 200 ]]; then
    fail "GET /healthz → $STATUS (ожидался 200)"
    show_body
    return
  fi
  if grep -q '"status":"ok"' "$BODY_FILE"; then
    ok "GET /healthz → 200, status ok"
  else
    fail 'GET /healthz → 200, но в ответе нет "status":"ok"'
    show_body
  fi
}

check_leads() {
  local payload='{"name":"Smoke test","phone":"+996700000000","audience":"STUDENT","message":"automated smoke check","consent":true}'
  local -a extra=()
  [[ -z $ORIGIN ]] || extra+=(-H "Origin: $ORIGIN")
  http POST /api/leads -H 'Content-Type: application/json' "${extra[@]}" --data "$payload"
  case $STATUS in
    200 | 201)
      ok "POST /api/leads без токена → $STATUS, заявка создана"
      ;;
    429)
      # Лимит 5 заявок за 10 минут с одного IP: эндпоинт жив и ограничитель работает.
      ok "POST /api/leads без токена → 429 (лимит этого IP уже исчерпан)"
      ;;
    *)
      fail "POST /api/leads без токена → $STATUS (ожидался 201)"
      show_body
      ;;
  esac

  # CORS: за воркером сайта Host (sslip-имя) и Origin (домен сайта) расходятся,
  # поэтому ответ заявки должен разрешать именно Origin сайта.
  if [[ -z $ORIGIN ]]; then
    skip 'CORS /api/leads не проверен: укажите --origin https://<домен-сайта>'
    return
  fi
  [[ $STATUS != 000 ]] || return
  local allow
  allow=$(header_value access-control-allow-origin || true)
  if [[ $allow == "$ORIGIN" ]]; then
    ok "POST /api/leads с Origin $ORIGIN → Access-Control-Allow-Origin: $ORIGIN"
  elif [[ -z $allow ]]; then
    fail "POST /api/leads с Origin $ORIGIN → нет Access-Control-Allow-Origin: лендинг не прочитает ответ"
  elif [[ $allow == '*' ]]; then
    fail "POST /api/leads с Origin $ORIGIN → Access-Control-Allow-Origin: * (с credentials браузер такой ответ отклонит)"
  else
    fail "POST /api/leads с Origin $ORIGIN → Access-Control-Allow-Origin: $allow (ожидался $ORIGIN)"
  fi
}

check_protected() {
  http GET /api/platform/branches
  if [[ $STATUS == 401 ]]; then
    ok "GET /api/platform/branches без токена → 401"
  else
    fail "GET /api/platform/branches без токена → $STATUS (ожидался 401)"
    show_body
  fi
}

check_socket() {
  http GET '/socket.io/?EIO=4&transport=polling'
  if [[ $STATUS != 200 ]]; then
    fail "GET /socket.io/ → $STATUS (ожидался 200)"
    show_body
    return
  fi
  if [[ $(head -c 1 "$BODY_FILE") == "0" ]] && grep -q '"sid"' "$BODY_FILE"; then
    ok "GET /socket.io/ → 200, engine.io handshake получен"
  else
    fail 'GET /socket.io/ → 200, но это не engine.io handshake (ожидался ответ 0{"sid":...})'
    show_body
  fi
}

printf 'Smoke-проверка %s\n' "$BASE_URL"
check_health
check_leads
check_protected
check_socket

printf '\nПроверок пройдено: %d, провалено: %d, пропущено: %d\n' "$PASSED" "$FAILED" "$SKIPPED"
((FAILED == 0)) || exit 1
