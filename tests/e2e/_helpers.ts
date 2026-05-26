import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LapsFile, Task } from '../../src/shared/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const projectRoot = path.resolve(__dirname, '../..')
export const mainEntry = path.join(projectRoot, 'out', 'main', 'index.js')

export interface TempLapsDir {
  dir: string
  lapsFile: string
  cleanup: () => void
}

export function makeTempLapsDir(initialFile?: LapsFile): TempLapsDir {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linesman-e2e-'))
  const lapsDir = path.join(dir, '.laps')
  fs.mkdirSync(lapsDir, { recursive: true })
  const lapsFile = path.join(lapsDir, 'laps.json')
  const file: LapsFile = initialFile ?? { version: 1, tasks: [] }
  writeFile(lapsFile, file)
  return {
    dir,
    lapsFile,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
  }
}

export function readFile(p: string): LapsFile {
  const raw = fs.readFileSync(p, 'utf8')
  return JSON.parse(raw) as LapsFile
}

export function writeFile(p: string, f: LapsFile): void {
  const ordered = {
    version: f.version,
    tasks: f.tasks.map((t) => {
      const o: Record<string, unknown> = {
        id: t.id,
        title: t.title,
        description: t.description
      }
      if (t.assignee && t.assignee.length > 0) o.assignee = t.assignee
      o.isDone = t.isDone
      o.createdAt = t.createdAt
      o.updatedAt = t.updatedAt
      o.completedAt = t.completedAt ?? null
      return o
    })
  }
  fs.writeFileSync(p, JSON.stringify(ordered, null, 2) + '\n', { encoding: 'utf8' })
}

export interface LaunchedApp {
  app: ElectronApplication
  win: Page
}

export async function launchApp(lapsFile: string): Promise<LaunchedApp> {
  const app = await electron.launch({
    args: [mainEntry],
    env: {
      ...process.env,
      LAPS_FILE: lapsFile,
      NODE_ENV: 'test',
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1'
    },
    cwd: projectRoot
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForFunction(() => Boolean((window as unknown as { laps?: unknown }).laps), {
    timeout: 10000
  })
  if (process.env.LAPS_E2E_DEBUG) {
    win.on('console', (msg) => {
      // eslint-disable-next-line no-console
      console.log('[renderer]', msg.type(), msg.text())
    })
    win.on('pageerror', (err) => {
      // eslint-disable-next-line no-console
      console.log('[renderer:error]', err.message)
    })
  }
  return { app, win }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function waitForPoll(): Promise<void> {
  return sleep(17000)
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  const iso = overrides.createdAt ?? new Date().toISOString()
  const t: Task = {
    id: overrides.id ?? 'test-' + Math.random().toString(16).slice(2, 8),
    title: overrides.title ?? 'Test lap',
    description: overrides.description ?? '',
    isDone: overrides.isDone ?? false,
    createdAt: iso,
    updatedAt: overrides.updatedAt ?? iso,
    completedAt: overrides.completedAt ?? null
  }
  if (overrides.assignee !== undefined) t.assignee = overrides.assignee
  return t
}

export function seedFile(tasks: Task[]): LapsFile {
  return { version: 1, tasks }
}
