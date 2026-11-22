# Applications

| Каталог | Назначение | Запуск |
|---|---|---|
| `api` | NestJS API, Prisma, Socket.IO, jobs | `npm --prefix apps/api run dev` |
| `web` | административная панель React/Vite | `npm --prefix apps/web run dev` |
| `mobile` | Expo / React Native | `npm --prefix apps/mobile run start` |

Лендинг остаётся в корне (`index.html`, `src/`), потому что его `dist`
публикуется отдельным Sites-деплоем (`freebuff.sites.json`).
