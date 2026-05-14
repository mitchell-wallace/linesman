import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')

export default async function globalSetup(): Promise<void> {
  const mainEntry = path.join(projectRoot, 'out', 'main', 'index.js')
  const preloadEntry = path.join(projectRoot, 'out', 'preload', 'index.cjs')
  const rendererIndex = path.join(projectRoot, 'out', 'renderer', 'index.html')
  if (existsSync(mainEntry) && existsSync(preloadEntry) && existsSync(rendererIndex)) return
  const result = spawnSync('npm', ['run', 'build'], {
    cwd: projectRoot,
    stdio: 'inherit'
  })
  if (result.status !== 0) {
    throw new Error(`npm run build failed with exit code ${result.status}`)
  }
}
