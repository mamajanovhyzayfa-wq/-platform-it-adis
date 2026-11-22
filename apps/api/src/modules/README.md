# Backend modules

Каждый каталог — один домен. Nest-модуль подключается в
`src/nest/app.module.ts`; Express-роутеры, ещё не перенесённые в Nest,
регистрируются в `src/legacy-routers.ts`.

## Конвенции

- `*.module.ts` — границы модуля и DI.
- `*.controller.ts` — HTTP-контракт, `@Roles(...)`, zod-валидация.
- `*.service.ts` — бизнес-правила и Prisma-запросы.
- `*.dto.ts` — zod-схемы входа.
- `*.access.ts` — правила доступа, если роли недостаточно.
- `*.spec.ts` / `test/*` — контрактные и unit-тесты.
- `README.md` — маршруты и ограничения.

`read-model` — общий шаблон списков для новых read-модулей: пагинация,
поиск, фильтры, `@Roles`, ошибки `422/404` и scoping по `userId`.

Карта всех 41 модуля: `docs/api/modules.md`.
