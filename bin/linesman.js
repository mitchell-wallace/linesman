#!/usr/bin/env node
import { existsSync, statSync } from 'node:fs'
import { spawn } from 'node:child_process'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const require = createRequire(import.meta.url)

const args = process.argv.slice(2)
const dev = args.includes('--dev')

function discoverLapsFile(startDir) {
  let dir = path.resolve(startDir)
  while (true) {
    const candidate = path.join(dir, '.laps', 'laps.json')
    if (existsSync(candidate)) {
      try {
        if (statSync(candidate).isFile()) return candidate
      } catch {
        /* ignore */
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

const file = process.env.LAPS_FILE || discoverLapsFile(process.cwd())

if (!file) {
  process.stderr.write(
    'linesman: no .laps/laps.json found in this directory or any parent.\n' +
      'Run `laps init` (from the laps CLI) or cd into a repo that has one.\n'
  )
  process.exit(1)
}

process.stdout.write(`linesman: using ${file}\n`)

const env = { ...process.env, LAPS_FILE: file, LINESMAN_CWD: process.cwd() }

if (dev) {
  const bin = path.join(projectRoot, 'node_modules', '.bin', 'electron-vite')
  const child = spawn(bin, ['dev'], { cwd: projectRoot, env, stdio: 'inherit' })
  child.on('exit', (code) => process.exit(code ?? 0))
} else {
  let electronPath
  try {
    electronPath = require('electron')
  } catch (err) {
    process.stderr.write(
      `linesman: failed to resolve electron binary. Did you run \`npm install\` in ${projectRoot}?\n`
    )
    process.stderr.write(String(err) + '\n')
    process.exit(1)
  }
  const mainEntry = path.join(projectRoot, 'out', 'main', 'index.js')
  if (!existsSync(mainEntry)) {
    process.stderr.write(
      `linesman: build output missing at ${mainEntry}. Run \`npm run build\` first or pass --dev.\n`
    )
    process.exit(1)
  }
  const child = spawn(electronPath, [projectRoot], {
    cwd: projectRoot,
    env,
    stdio: 'inherit'
  })
  child.on('exit', (code) => process.exit(code ?? 0))
}
