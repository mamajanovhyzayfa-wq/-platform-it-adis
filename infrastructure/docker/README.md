# Docker

- `docker-compose.yml` (корень) — PostgreSQL, Redis и API для разработки.
- `docker-compose.prod.yml` (корень) — production-топология: PostgreSQL, Redis,
  MinIO, API, admin-web, nginx, Prometheus.
- `apps/api/Dockerfile` — API (multi-stage build, Prisma migrate на старте).
- `apps/web/Dockerfile` — статическая сборка admin-web + nginx.
- `infrastructure/nginx/` — конфигурации edge и admin.

Сборка из корня:

```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```
