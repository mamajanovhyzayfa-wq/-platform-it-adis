#!/usr/bin/env bash
# Запускает команду шага и, если она упала, публикует хвост её вывода
# аннотацией GitHub Actions.
#
# Зачем: скачивание логов job'а через API требует прав администратора
# репозитория, поэтому причину падения нельзя прочитать извне (из PR, из
# агента, из скрипта). Аннотации check-run'а читаются без токена через
# GET /repos/{owner}/{repo}/check-runs/{id}/annotations, если репозиторий
# публичный. Полный вывод при этом остаётся в логе шага — обёртка ничего не
# скрывает и не меняет код возврата команды.
#
#   infrastructure/ci/run-annotated.sh 'Собрать образы' \
#     docker compose -f docker-compose.prod.yml build
set -euo pipefail

if (($# < 2)); then
  echo "использование: $0 <заголовок> <команда> [аргументы...]" >&2
  exit 2
fi

title=$1
shift

slug=$(printf '%s' "$title" | tr -c 'a-zA-Z0-9' '-' | cut -c1-40)
log="${RUNNER_TEMP:-/tmp}/ci-step-${slug}.log"

status=0
"$@" 2>&1 | tee "$log" || status=${PIPESTATUS[0]}

if ((status == 0)); then
  exit 0
fi

# Аннотация — одна строка: проценты и переводы строк экранируются по правилам
# workflow-команд GitHub Actions.
summary=$(tail -c 1800 "$log" | tr -d '\r')
summary=${summary//'%'/'%25'}
summary=${summary//$'\n'/'%0A'}
echo "::error title=${title} (код ${status})::${summary}"
exit "$status"
