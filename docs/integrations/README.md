# Интеграции

Внешние сервисы подключаются отдельными адаптерами в
`apps/api/src/integrations/adapters`. Адаптер знает только протокол провайдера:
он не импортирует Nest, Express и клиентский код, поэтому его можно вызывать
из любого backend-модуля и покрывать тестами без базы данных.

```text
apps/api/src/integrations/
├── core/
│   ├── types.ts      контракт адаптера и статусы проверки
│   ├── registry.ts   реестр, health-check, запись в журнал
│   ├── retry.ts      повторы с экспоненциальной паузой и джиттером
│   ├── http.ts       fetch с таймаутом, повторами и безопасными ошибками
│   ├── secrets.ts    чтение секретов, маскирование, redact
│   ├── event-log.ts  журнал IntegrationEvent
│   └── errors.ts     IntegrationError, признак retryable
├── adapters/         по одному файлу на сервис
└── index.ts          единый реестр integrationRegistry
```

## Правила безопасности

- Секреты живут **только на сервере**: в переменных окружения или в БД в
  зашифрованном виде (AES-256-GCM, ключ `DATA_ENCRYPTION_KEY`, `lib/crypto.ts`).
- В таблице `IntegrationConfig` хранятся только **имена** переменных
  (`secretEnvVars`), настройки без секретов и последний статус проверки.
- Клиент (web, mobile) получает `id`, `category`, `configured`, `missingEnv`,
  `status`, задержку и текст ошибки. Значения токенов не попадают ни в ответ
  API, ни в журнал, ни в текст ошибки (`safeErrorMessage`).
- Настройки с полями вида `apiKey`, `token`, `password` отклоняются с `422`:
  секрет задаётся переменной окружения, а не через админ-панель.
- Проверка доступности никогда не бросает исключение наружу: она возвращает
  `ok`, `degraded`, `not_configured` или `unreachable`.

## Адаптеры

| id | Категория | Переменные (★ — секрет) | Что проверяет health-check |
|---|---|---|---|
| `livedigital` | video | `LIVEDIGITAL_API_URL`, `LIVEDIGITAL_API_TOKEN`★, `LIVEDIGITAL_SPACE_ID`, `LIVEDIGITAL_WEBHOOK_SECRET`★ | `GET /spaces/{spaceId}/rooms?limit=1` — доступность API, токен и пространство |
| `google` | identity | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`★ | OIDC discovery `accounts.google.com` |
| `apple` | identity | `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`★ | OIDC discovery `appleid.apple.com` |
| `email` | email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`★, `MAIL_FROM` | `transporter.verify()` |
| `apyhub` | email | `APY_TOKEN`★ | `GET /api/public/regions` — доступность API; ключ подтверждается реальным запросом формы |
| `sms` | sms | `SMS_PROVIDER`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`★, `TWILIO_FROM` | `GET /2010-04-01/Accounts/{sid}.json` |
| `expo-push` | push | `EXPO_ACCESS_TOKEN` (необязателен) | `HEAD exp.host`; без токена статус `degraded`, отправка работает |
| `google-calendar` | calendar | `GOOGLE_CALENDAR_CLIENT_ID`, `..._SECRET`★, `..._REFRESH_TOKEN`★, `GOOGLE_CALENDAR_ID` | обмен refresh-токена + `GET /calendar/v3/calendars/{id}` |
| `apple-calendar` | calendar | `APPLE_CALDAV_URL`, `APPLE_CALDAV_USERNAME`, `APPLE_CALDAV_PASSWORD`★ | CalDAV `PROPFIND Depth: 0` |
| `outlook` | calendar | `OUTLOOK_TENANT_ID`, `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`★ | client credentials + `GET graph/v1.0/organization` |
| `freedompay` | payments | `FREEDOMPAY_MERCHANT_ID`, `FREEDOMPAY_SECRET_KEY`★, `FREEDOMPAY_BASE_URL` | доступность хоста провайдера |
| `elsom` | payments | `ELSOM_BASE_URL`, `ELSOM_PARTNER_CODE`, `ELSOM_PASSWORD`★ | доступность хоста провайдера |
| `accounting` | accounting | `ACCOUNTING_PROVIDER`, `ACCOUNTING_BASE_URL`, `ACCOUNTING_API_KEY`★ | `GET {base}/health` с `X-API-Key` |
| `openai` | ai | `OPENAI_API_KEY`★, `OPENAI_BASE_URL`, `OPENAI_MODEL` | `GET /models` с Bearer-токеном |
| `s3` | storage | `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`★, `S3_SECRET_KEY`★ | `HeadBucket` |

Платёжные API не публикуют ping-метод: проверяется доступность хоста, а
реквизиты подтверждаются реальной платёжной сессией. Это отражается статусом
`degraded`, а не имитацией успешной оплаты.

## Повторы и ошибки

| Ситуация | Поведение |
|---|---|
| сеть, таймаут, `429`, `5xx` | до 3 попыток, пауза `250 мс → 5 с` с джиттером 50–100 % |
| `401`, `403`, неверная подпись | без повторов: ключ или реквизиты неверны |
| `connect()` (обмен токена) | 2 попытки, затем `unreachable` |
| адаптер не настроен | сетевых вызовов нет, `not_configured`, запись `SKIPPED` |

Ошибки приводятся к `502`/`503` с кодом (`NETWORK_ERROR`, `HTTP_ERROR`,
`OAUTH_FAILED`, `NOT_CONFIGURED`). Бизнес-операция получает понятный отказ, а
не «пустой успех».

## Журнал событий

`IntegrationEvent`: `provider`, `action` (`health_check`, `connect`, `request`,
`webhook`, `config`), `status` (`OK`, `FAILED`, `SKIPPED`), `attempts`,
`durationMs`, очищенное `message`, `metadata` (проходит `redact`), `actorId`,
`createdAt`. Ошибка записи журнала не ломает основной запрос.

## API (ADMIN)

| Метод | Путь | Назначение |
|---|---|---|
| `GET` | `/api/integrations` | все адаптеры: настройка, последний статус, настройки филиала |
| `GET` | `/api/integrations/status` | сводка ключевых провайдеров (совместимость с панелью) |
| `GET` | `/api/integrations/events?provider=&status=&page=&limit=` | журнал, до 100 записей на страницу |
| `POST` | `/api/integrations/:id/check` | проверка одного адаптера + запись в журнал |
| `POST` | `/api/integrations/check-all` | проверка всех адаптеров |
| `PATCH` | `/api/integrations/:id` | `enabled`, `settings`, имена `secretEnvVars` |
| `POST` | `/api/integrations/accounting/entries` | экспорт счёта/платежа/возврата/расхода в бухгалтерию |

```bash
TOKEN='access-токен администратора'
curl -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/integrations
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:4000/api/integrations/livedigital/check
curl -X PATCH -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"enabled":false}' http://localhost:4000/api/integrations/email
curl -H "Authorization: Bearer $TOKEN" \
  'http://localhost:4000/api/integrations/events?provider=accounting&limit=20'
```

Экспорт в бухгалтерию:

```json
{
  "type": "invoice",
  "number": "INV-2026-00042",
  "amount": 450000,
  "currency": "KGS",
  "occurredAt": "2026-11-20T10:00:00.000Z",
  "counterparty": "ОсОО «Пример»",
  "externalId": "3f0c0f7a-6f5f-4c2a-9c1f-8a2b1d3e4f50"
}
```

## Как добавить адаптер

1. Создайте `adapters/<service>.adapter.ts` и реализуйте `IntegrationAdapter`
   (`descriptor`, `missingEnv`, `isConfigured`, `connect?`, `probe`).
2. Используйте `readSecret`/`missingVariables` из `core/secrets.ts` — значения
   секретов не должны попадать в `descriptor` или текст ошибки.
3. Добавьте адаптер в массив `integrationRegistry` (`integrations/index.ts`).
4. Опишите переменные в `apps/api/.env.example` и в таблице выше.
5. Добавьте тест: настройка, успешный probe, ошибка провайдера, отсутствие
   утечки секрета. Образец — `apps/api/test/integrations.test.ts`.

## Ограничения

- Доменная синхронизация календарей и запись в бухгалтерию выполняются только
  при настроенных реквизитах; без них маршруты возвращают `503`, а не создают
  фиктивные события.
- Legacy-код LiveKit читает `LIVEKIT_*`, только если они заданы явно; в
  шаблонах этих переменных нет. Актуальный видеопровайдер — LiveDigital.
- Ключи из админ-панели не вводятся: их задаёт администратор сервера в
  переменных окружения (в production — секреты платформы).
