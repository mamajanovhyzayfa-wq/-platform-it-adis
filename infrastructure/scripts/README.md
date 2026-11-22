# Operations scripts

Скрипты обслуживания запускаются из корня и используют окружение production.

- `pg_dump`/`pg_restore` — backup и restore БД (см. `apps/api/src/modules/backups`).
- `tar` — архив файлов библиотеки; проверка `tar -tzf` перед restore.
- `curl /healthz` — readiness API.
- `curl /metrics` — метрики Prometheus.

Секреты и дампы не коммитятся: каталоги `apps/api/backups`, `apps/api/storage`
исключены в `.gitignore`.
