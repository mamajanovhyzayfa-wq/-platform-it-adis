# Infrastructure

Каталог для конфигураций развёртывания ITadis. Сейчас здесь только описание целевой топологии и
чек-лист: production-конфигурации будут добавлены на этапе 12 (подготовка к запуску). Локальная
разработка уже полностью описана в корневом `docker-compose.yml`.

## Что уже есть

| Файл | Назначение |
| --- | --- |
| `../docker-compose.yml` | PostgreSQL 16, Redis 7, LiveKit (`--dev`), backend для локальной разработки |
| `../backend/Dockerfile` | Сборка образа backend |
| `../.env.example` | Переменные compose: порты, БД, ключи LiveKit |

## Целевая production-топология

```
                ┌───────────────────────────────────────────┐
   HTTPS/WSS    │  nginx                                    │
  ────────────▶ │  • TLS (Let's Encrypt)                    │
                │  • app.itadis.kg      → admin-web (SPA)   │
                │  • itadis.kg          → лендинг           │
                │  • api.itadis.kg/api  → backend:4000      │
                │  • api.itadis.kg/socket.io → WebSocket    │
                └───────────────┬───────────────────────────┘
                                │
                ┌───────────────▼───────────────┐
                │  backend (Node 20, 1–N реплик)│
                │  NestJS + Socket.IO           │
                └───┬───────────────┬───────────┘
                    │               │
        ┌───────────▼───┐   ┌───────▼────────┐
        │ PostgreSQL 16 │   │ Redis 7        │
        │ managed, HA   │   │ rate limit/кеш │
        └───────────────┘   └────────────────┘
                    │
        ┌───────────▼────────────────────────────┐
        │ LiveKit (SFU) + Egress                 │
        │ S3-совместимое хранилище записей       │
        └────────────────────────────────────────┘
```

## Что появится в этом каталоге на этапе 12

- `nginx/itadis.conf` — TLS, статика admin/landing, прокси `/api` и `/socket.io` с корректными
  заголовками `Upgrade`/`Connection`, `client_max_body_size`.
- `docker-compose.prod.yml` — backend, nginx, LiveKit, Egress; PostgreSQL и Redis как внешние сервисы.
- `backup/postgres-backup.sh` — `pg_dump` по расписанию, ротация, проверка восстановления.
- `monitoring/` — health-проверки (`/healthz`), сбор логов, алерты по 5xx и доступности БД.
- `livekit/livekit.yaml` — production-конфигурация: ключи из секретов, TURN, лимиты, webhooks на
  `https://api.itadis.kg/api/video/webhooks/livekit`.
- `scripts/bootstrap-admin.ts` — создание первого администратора без демо-данных.

## Чек-лист перед публикацией

### Секреты

- [ ] `JWT_ACCESS_SECRET` и `JWT_REFRESH_SECRET` — случайные, ≥ 32 символов, разные, не из примеров.
- [ ] Ключи LiveKit, S3, SMTP — только в секретах окружения, не в git и не в мобильном бандле.
- [ ] `APP_ORIGIN` — точный origin админ-панели.
- [ ] Демо-аккаунты из seed отсутствуют в production.

### База данных

- [ ] Управляемый PostgreSQL с ежедневными бэкапами и проверкой восстановления.
- [ ] Миграции применяются `prisma migrate deploy` в CI/при деплое, каталог `prisma/migrations` в git.
- [ ] Пул соединений рассчитан на число реплик backend.

### Сеть и безопасность

- [ ] HTTPS обязателен; HSTS; редирект с HTTP.
- [ ] WebSocket `/socket.io` проксируется с upgrade-заголовками.
- [ ] Rate limiting вынесен в Redis при нескольких репликах.
- [ ] Порты PostgreSQL/Redis не доступны из интернета.
- [ ] Логи без персональных данных и токенов.

### LiveKit

- [ ] `LIVEKIT_URL` указывает на `wss://` production-сервер.
- [ ] Webhooks подписаны и доступны по HTTPS; секрет совпадает с backend.
- [ ] Egress и S3 настроены, записи доступны только через авторизованные маршруты.
- [ ] TURN/UDP-порты открыты для мобильных сетей.

### Мобильные сборки

- [ ] `eas.json` с профилями `development`, `preview`, `production`.
- [ ] Application ID `kg.itadis.app` и bundle identifier совпадают с магазинами.
- [ ] Иконка, splash, версии и разрешения камеры/микрофона заданы в `app.json`.
- [ ] Push-уведомления и deep linking настроены (после подключения `expo-notifications`).

### Наблюдаемость

- [ ] Health-check `/healthz` в балансировщике.
- [ ] Алерты: доступность API, 5xx, ошибки БД, заполнение диска, неудачные вебхуки.
- [ ] Ротация и хранение логов ≥ 30 дней.
