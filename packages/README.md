# Shared packages

- `shared-types` — роли, `Paginated<T>`, `ApiErrorBody`, имена модулей.
- `validation` — общие zod-схемы пагинации, дат, email и телефона.
- `api-client` — типизированный fetch-клиент с подстановкой токена.
- `ui` — дизайн-токены в TS и CSS.
- `config` — общий strict `tsconfig.base.json`.

Пакеты не содержат секретов, Prisma-клиента или React-хуков. Приложение
подключает их через workspace-зависимости; сборка каждого пакета не требуется,
исходники экспортируются как TypeScript.
