import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function run(args) {
  execFileSync(npm, args, { cwd: root, stdio: 'inherit', env: process.env })
}

// Лендинг собирается первым: Vite очищает dist, после чего туда добавляется кабинет.
run(['run', 'build'])
// Кабинет живёт по /app/, поэтому его ассеты и маршруты получают этот префикс.
run(['--prefix', 'apps/web', 'run', 'build', '--', '--base=/app/'])

const landingIndex = resolve(root, 'dist/index.html')
const cabinetIndex = resolve(root, 'apps/web/dist/index.html')
if (!existsSync(landingIndex) || !existsSync(cabinetIndex)) {
  throw new Error('Сборка сайта не завершена: не найден index.html лендинга или кабинета')
}

rmSync(resolve(root, 'dist/app'), { recursive: true, force: true })
cpSync(resolve(root, 'apps/web/dist'), resolve(root, 'dist/app'), { recursive: true })
console.log('Сайт собран: лендинг в dist/, кабинет в dist/app/')
