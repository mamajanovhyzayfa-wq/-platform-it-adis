# Структура монорепозитория

Монорепозиторий разделён по приложениям, переиспользуемым пакетам и инфраструктуре.
Внутри приложений код группируется по доменам, а не по типам файлов: рядом лежат
маршрут, схема, сервис и тесты одной функции.

```
ITadis/
├── apps/
│   ├── api/                         NestJS + Prisma: REST, Socket.IO, задания
│   │   ├── src/
│   │   │   ├── modules/<domain>/    доменные модули: controller/service/schemas
│   │   │   │   └── services/        подсервисы крупного домена (scheduling)
│   │   │   ├── nest/                ядро Nest: common, guards, filters, prisma, rbac
│   │   │   ├── config/              zod-схема окружения
│   │   │   ├── integrations/        адаптеры внешних провайдеров
│   │   │   ├── jobs/                фоновые задания вне конкретного домена
│   │   │   ├── websocket/           Socket.IO и авторизация рукопожатия
│   │   │   ├── lib/                 общие серверные утилиты
│   │   │   ├── middleware/          tenant, request context
│   │   │   ├── docs/                OpenAPI
│   │   │   ├── legacy-routers.ts    временный мост для ещё не перенесённых доменов
│   │   │   └── main.ts              bootstrap
│   │   └── prisma/                  schema.prisma, migrations, seed
│   │
│   ├── web/                         React + Vite: кабинет и админ-панель
│   │   ├── src/
│   │   │   ├── app/                 App.tsx (маршруты, guards), navigation.ts
│   │   │   ├── layouts/             каркас интерфейса (AppLayout)
│   │   │   ├── pages/               route-level страницы
│   │   │   ├── features/            доменные панели и локальные хуки
│   │   │   │   ├── community/
│   │   │   │   └── scheduling/
│   │   │   ├── components/          переиспользуемые UI-компоненты
│   │   │   ├── api/                 типизированный слой запросов
│   │   │   ├── hooks/               общие React-хуки
│   │   │   ├── i18n/                провайдер, форматтеры, типы ключей
│   │   │   ├── locales/             ru/ky/en JSON-словари
│   │   │   ├── styles/              CSS по слоям: tokens/layout/controls/...
│   │   │   ├── theme.ts             тема и доступность
│   │   │   └── cookies.ts           cookie-согласия
│   │   └── package.json
│   │
│   └── mobile/                      Expo / React Native
│       └── src/
│           ├── app/                 Expo Router: файловая маршрутизация
│           ├── components/          UI и доменные компоненты
│           ├── features/            профиль и переиспользуемые сценарии
│           ├── api/                 axios-клиент и доменные вызовы
│           ├── offline/             кеш, очередь, синхронизация
│           ├── i18n/                ru/ky/en
│           ├── store/               Zustand
│           └── theme/               токены и темы
│
├── packages/
│   ├── shared-types/                роли, API-ответы, имена модулей
│   ├── validation/                  общие zod-схемы
│   ├── api-client/                  fetch-клиент без фреймворка
│   ├── ui/                          дизайн-токены TS + CSS
│   └── config/                      общий strict tsconfig
│
├── infrastructure/
│   ├── docker/                      Docker/nginx-конфигурация
│   ├── deployment/                  release/deploy-скрипты
│   ├── monitoring/                  Prometheus/alerts
│   └── scripts/                     backup/restore и обслуживание
│
├── docs/
│   ├── architecture/                слои, модули, решения
│   ├── api/                         HTTP-контракты и карта модулей
│   ├── database/                    схема и миграции
│   └── deployment/                  локальный запуск и production
│
├── docker-compose.yml               dev-инфраструктура
├── docker-compose.prod.yml          production-топология
├── package.json                     workspace root
└── .env.example
```

## Web: страницы и feature-модули

`pages/` содержит только route-level компоненты: заголовок, вкладки и композицию
панелей. Крупные сценарии живут в `features/<domain>/`.

| Домен | Feature-модуль | Что внутри |
| --- | --- | --- |
| Сообщество | `features/community` | `CommunityPage`, чаты, встречи, объявления, мероприятия и общие подписи |
| Расписание | `features/scheduling` | `SchedulePage`, календарь, карточка занятия, посещаемость, шаблоны, аудитории, согласования, статистика, настройки |

Правила:

- страница не содержит бизнес-логику и не превышает ~150 строк;
- панель или вкладка — отдельный файл в `features/<domain>/`;
- общие подписи и чистые функции домена — в `shared.ts`, а не в компоненте;
- запросы — в `src/api/<domain>.ts`; компонент не вызывает `fetch` напрямую;
- `AppLayout` и общие UI-компоненты не импортируют страницы или features;
- новый feature не импортирует внутренности другого feature; общее выносится в
  `components/`, `hooks/` или `api/`.

`store/` в web нет намеренно: серверное состояние принадлежит TanStack Query,
локальное состояние форм и вкладок живёт в компонентах. Если появится действительно
глобальное клиентское состояние, для него будет создан `store/`, а не «на всякий случай».

`api/` — это service-layer: типизированные функции, ошибки, refresh и step-up.
Отдельный каталог `services/` не создаётся, чтобы не дублировать слой.

## API: доменные модули

Каждый каталог `src/modules/<domain>/` — один ограниченный контекст. Внутри:

```
<domain>.controller.ts   HTTP-контракт и роли
<domain>.service.ts      бизнес-логика
<domain>.schemas.ts      Zod-схемы входа
<domain>.time.ts         чистые функции домена (если нужны)
```

Правила:

- контроллер не содержит запросов к Prisma;
- сервис не знает о HTTP и не формирует ответ Express;
- общие guards, фильтры и pipe — в `src/nest/common`;
- фоновые задачи, не принадлежащие домену, — в `src/jobs`;
- Socket.IO и авторизация handshake — в `src/websocket`;
- внешние провайдеры — в `src/integrations`, без утечки секретов в ответы;
- домен не импортирует контроллер другого домена; общая операция вызывается через
  экспортируемый сервис.

Крупные домены (`scheduling`, `lms`, `assessment`, `economy`) уже разделены на
самостоятельные сервисы (`video`, `calendar`, `schedule-chat`, `testing`, `exam` и т.д.).
В `scheduling` дополнительно вынесены `services/scheduling-classrooms.service.ts`,
`services/scheduling-analytics.service.ts` и `services/scheduling-settings.service.ts`;
контроллер ходит в них напрямую, а `SchedulingService` остаётся координатором
расписания. Следующий шаг при росте — так же вынести поддомены из `lms.service.ts`;
внешние маршруты при этом не меняются. Новые методы в крупные сервисы не добавляются
без выделения поддомена.

## Стили

`apps/web/src/styles/index.css` — единственная точка входа кабинета. Слои идут в
порядке каскада: сначала базовая дизайн-система (`tokens`, `layout`, `controls`, ...),
затем `redesign/*`. Публичный лендинг так же собран из `src/styles/landing/*`.
Один слой — одна зона ответственности; файл не должен разрастаться до тысяч строк.
Новые стили добавляются в существующий слой, а не в конец `index.css`.

## Пакеты и зависимости

1. `apps/*` могут импортировать `packages/*`; обратное запрещено.
2. `packages/shared-types` не импортирует Prisma, React или Nest.
3. `packages/api-client` зависит только от `shared-types` и `fetch`.
4. Пакеты не содержат секретов, Prisma-клиента или React-хуков.
5. Внутри приложения imports идут только по направлению `page → feature → components/api`.

## Размер файлов

- Новый компонент/сервис — до ~400 строк; при превышении выделяется подмодуль.
- Страница — до ~150 строк; панели и формы выносятся в `features`.
- CSS-слой — до ~700 строк; дальше дробится по компонентам.
- Один файл не должен совмещать UI, запросы и бизнес-правила.

## Запуск

```bash
cp .env.example .env
npm --prefix apps/api run prisma:migrate
npm run dev:api
npm run dev:web
npm run dev:mobile
```

Проверки: `npm --prefix apps/api run typecheck && npm --prefix apps/api test`,
`npm --prefix apps/web run typecheck && npm --prefix apps/web run build`,
`cd apps/mobile && npx tsc --noEmit && npm test`.
