# P0-1: сайт отдаёт 503 — как поднять API и связать его с сайтом

Статус: **требует владельца**. Код готов, но у агента нет доступа к VPS и к
панели freebuff.site, поэтому шаги 1–7 выполняет владелец.

## Что именно сломано

`https://platform-it-adis-nmtovk.freebuff.site` — это статический лендинг и
воркер сайта. Воркер проксирует `/api/*`, `/socket.io/*` и `/healthz` на
backend, адрес которого берётся из переменной окружения сайта `API_ORIGIN`.

Если `API_ORIGIN` не задан, воркер отвечает:

```json
{ "error": { "code": "API_NOT_CONFIGURED", "message": "Сервер ITadis временно недоступен…" } }
```

с кодом **503** — на любой `/api/*` и на `/healthz`. Именно это показывает
скриншот посетителя. Причина не в коде ветки: backend просто нигде не
развёрнут (`203.0.113.10` в примерах — адрес из TEST-NET-3, он не маршрутизируется).

Проверка текущего состояния:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://platform-it-adis-nmtovk.freebuff.site/api/healthz
# 503 — API не подключён
```

Цель: `200` и JSON `{"status":"ok",...}` на этом же URL.

---

## 1. Арендовать VPS

Минимальная конфигурация (рассчитана на `docker-compose.prod.yml`: PostgreSQL
16 + PgBouncer + Redis + S3-совместимое хранилище + ClamAV + backend + admin +
nginx + Caddy):

| Параметр | Значение |
| --- | --- |
| CPU | 4 vCPU |
| RAM | **8 ГБ** (compose задаёт `shared_buffers=1GB`, `effective_cache_size=3GB`) |
| Диск | 80 ГБ SSD/NVMe (образы + базы ClamAV ~2 ГБ + бэкапы) |
| ОС | Ubuntu 24.04 LTS |
| Порты | снаружи открыты только **22, 80, 443/tcp, 443/udp** |

Домен покупать не обязательно: TLS выдаётся на `sslip.io`-имя, собранное из
IP сервера (`203.0.113.10` → `203-0-113-10.sslip.io`).

## 2. Подготовить сервер

```bash
ssh root@<IP>
apt-get update && apt-get install -y ca-certificates curl git
# Docker Engine + compose v2 (официальный скрипт)
curl -fsSL https://get.docker.com | sh
docker compose version   # ожидается v2.x
```

Файрвол:

```bash
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
ufw --force enable
```

Порт 80 обязателен: Caddy проходит ACME HTTP-01 и делает редирект на HTTPS.

## 3. Получить код

```bash
git clone https://github.com/mamajanovhyzayfa-wq/-platform-it-adis.git
cd -- -platform-it-adis
# до мержа PR — ветка аудита; после мержа достаточно main
git checkout audit/full-analysis-2026-11-27
```

## 4. Заполнить `.env.production`

```bash
cp .env.production.example .env.production
chmod 600 .env.production
$EDITOR .env.production
```

Обязательные значения (compose падает до старта, если их нет):

```ini
POSTGRES_PASSWORD=<32+ случайных символов>
JWT_ACCESS_SECRET=<32+ случайных символов>
JWT_REFRESH_SECRET=<32+ случайных символов>
DATA_ENCRYPTION_KEY=<32+ случайных символов>
S3_ACCESS_KEY=<логин S3-хранилища>
S3_SECRET_KEY=<пароль S3-хранилища>
ACME_EMAIL=<ваш email для Let's Encrypt>

PUBLIC_HOSTNAME=203-0-113-10.sslip.io   # замените на <ip-через-дефисы>.sslip.io
APP_ORIGIN=https://203-0-113-10.sslip.io
ADMIN_WEB_ORIGIN=https://203-0-113-10.sslip.io
API_PUBLIC_URL=https://203-0-113-10.sslip.io
PRIMARY_DOMAIN=203-0-113-10.sslip.io
PLATFORM_DOMAIN=203-0-113-10.sslip.io
ALLOW_PRIMARY_FALLBACK=false

PLATFORM_ADMIN_EMAIL=<email администратора>
PLATFORM_ADMIN_PASSWORD=<пароль администратора, 12+ символов>
```

Важно: `PRIMARY_DOMAIN` **должен совпадать** с `PUBLIC_HOSTNAME`. API выбирает
филиал по заголовку `Host`, и при расхождении вернёт `404 BRANCH_NOT_FOUND`
(сайт покажет «Сервер ITadis временно недоступен» уже по другой причине).

Остальные переменные (SMTP, LiveDigital, платежи, Google/Apple, AI) можно
оставить пустыми — соответствующие адаптеры перейдут в `not_configured` и не
помешают старту. Секреты хранятся только в `.env.production` на сервере;
в git, в чат и в переменные сайта они не попадают.

Генерация секретов:

```bash
for i in 1 2 3; do openssl rand -hex 32; done
```

## 5. Запустить стек

```bash
infrastructure/scripts/deploy.sh --check --ip <IP>   # preflight без запуска
infrastructure/scripts/deploy.sh --ip <IP>           # сборка, миграции, ожидание /healthz
```

Скрипт сам впишет `PUBLIC_HOSTNAME` в `.env.production`, проверит порты 80/443,
выполнит `docker compose up -d --build`, дождётся TLS-сертификата и
`https://<PUBLIC_HOSTNAME>/healthz`.

Эквивалент вручную:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

Ожидаемо: `running` у `postgres`, `pgbouncer`, `redis`, `minio`, `clamav`,
`antivirus`, `backend`, `admin`, `edge`, `caddy`; `exited (0)` у `migrate`,
`bootstrap`, `minio-init`. Первые минуты `clamav` — `health: starting`
(скачивает базы, `start_period` 6 минут), это не ошибка.

Проверка API напрямую:

```bash
curl -fsS https://<PUBLIC_HOSTNAME>/healthz
# {"status":"ok",...}

curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'Host: <PUBLIC_HOSTNAME>' -H 'content-type: application/json' \
  -d '{"identifier":"probe@example.com"}' \
  https://<PUBLIC_HOSTNAME>/api/auth/password/request
# 202
```

Smoke-проверка стека с Origin сайта (создаёт одну настоящую заявку «Smoke test»):

```bash
infrastructure/scripts/smoke.sh https://<PUBLIC_HOSTNAME> \
  --origin https://platform-it-adis-nmtovk.freebuff.site
# Проверок пройдено: 5, провалено: 0, пропущено: 0
```

## 6. Прописать `API_ORIGIN` в freebuff.site — обязательный шаг

Без него сайт продолжит отдавать 503, даже когда API уже работает.

1. Откройте панель **freebuff.site** и проект этого сайта.
2. Выберите сайт `platform-it-adis-nmtovk` → раздел с переменными окружения
   сайта (Sites → сайт → Settings → Environment / переменные; точное название
   пункта в интерфейсе может отличаться — нужны **переменные окружения сайта**,
   а не секреты деплоя).
3. Добавьте переменную:

   ```ini
   API_ORIGIN=https://<PUBLIC_HOSTNAME>
   ```

   Требования: только `https://`, без завершающего `/`, без пути; значение
   должно совпадать с `PUBLIC_HOSTNAME` из `.env.production`.
4. Сохраните изменения и переопубликуйте сайт (Redeploy/Publish), чтобы воркер
   получил новое окружение.
5. Повторите проверку:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' https://platform-it-adis-nmtovk.freebuff.site/api/healthz
   # 200
   curl -s https://platform-it-adis-nmtovk.freebuff.site/api/healthz
   # {"status":"ok",...}
   curl -s -o /dev/null -w '%{http_code}\n' https://platform-it-adis-nmtovk.freebuff.site/healthz
   # 200 и JSON, а не index.html
   ```

6. Откройте сайт в браузере: форма заявки сохраняется, вход в кабинет
   `/app/` работает, в DevTools нет `503`/`CORS` на `/api/*`.

## 7. Что проверить после публикации

| Проверка | Как | Ожидаемо |
| --- | --- | --- |
| API жив | `curl -s https://site/api/healthz` | `200`, `{"status":"ok"}` |
| Заявка с лендинга | отправить форму на сайте | `201`, заявка видна админу |
| Вход в кабинет | `/app/` под администратором из шага 4 | дашборд, без 503 |
| Вебхуки LiveDigital | запрос от провайдера | подпись проверяется, 200/401 без 5xx |
| Метрики закрыты | `curl -o /dev/null -w '%{http_code}' https://api-host/metrics` | `404` (в production выключено) |
| Swagger закрыт | `curl -o /dev/null -w '%{http_code}' https://api-host/docs` | `404` |

## 8. Токен GitHub, чтобы открыть PR

Ветку агент пушит, но PR создаётся через API GitHub, а в окружении агента
нет креденшелов. Нужен личный токен владельца.

1. GitHub → **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**.
2. **Repository access**: *Only select repositories* →
   `mamajanovhyzayfa-wq/-platform-it-adis`.
3. **Repository permissions**:

   | Право | Уровень | Зачем |
   | --- | --- | --- |
   | Metadata | Read-only (ставится сам) | обязательное |
   | Contents | **Read and write** | пуш ветки, squash-merge |
   | Pull requests | **Read and write** | создать PR и смержить |
   | Actions, Checks | Read-only | следить за CI |

   Organization permissions не нужны.
4. **Expiration**: 7–30 дней; токен одноразовый по смыслу — после мержа его
   можно отозвать.
5. **Generate token** и скопируйте значение: GitHub показывает его один раз.
6. Freebuff → **Settings → Project settings → Secrets** → добавьте секрет с
   именем `GH_TOKEN` и значением токена. Не присылайте токен в чат, не
   записывайте в `.env`, `.env.production` или git — секреты проекта читает
   только агент.
7. Напишите агенту «открой PR» — он создаст PR из
   `audit/full-analysis-2026-11-27` в `main`, дождётся проверок и смержит
   squash только по явной просьбе.

Классический токен (Personal access tokens → Tokens (classic)) тоже подойдёт:
достаточно scope `repo`.

## Если что-то не работает

| Симптом | Причина | Что делать |
| --- | --- | --- |
| Сайт всё ещё 503 `API_NOT_CONFIGURED` | `API_ORIGIN` не задан или сайт не переопубликован | шаг 6, затем Redeploy |
| `/api/healthz` → 404 `BRANCH_NOT_FOUND` | `PRIMARY_DOMAIN` ≠ `PUBLIC_HOSTNAME` | исправить `.env.production`, `docker compose up -d backend` |
| `/api/healthz` → 502 | backend не стартовал | `docker compose … logs --tail=200 backend` |
| Нет TLS-сертификата | закрыт 80/tcp или неверный `PUBLIC_HOSTNAME` | открыть порт 80, проверить DNS `sslip.io` |
| `backend` перезапускается | нет обязательной переменной | `docker compose … logs backend`, сверить шаг 4 |
| Заявка отклоняется CORS | `APP_ORIGIN` не равен домену сайта | `APP_ORIGIN=https://platform-it-adis-nmtovk.freebuff.site` |

## Границы ответственности

Выполнено в репозитории: воркер и его тесты, `docker-compose.prod.yml`,
`deploy.sh`, smoke-проверки, production-health workflow, а также закрытие
`/docs` и `/metrics` в production.

Требует владельца: аренда VPS (шаг 1), доступ по SSH (шаги 2–5), переменная
`API_ORIGIN` в панели freebuff.site (шаг 6) и `GH_TOKEN` в секретах проекта
(шаг 8). У агента нет ни доступа к серверу, ни прав на панель, ни креденшелов
GitHub, поэтому эти шаги нельзя выполнить автоматически.
