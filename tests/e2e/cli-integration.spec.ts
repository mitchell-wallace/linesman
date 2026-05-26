import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { makeTask, makeTempLapsDir, projectRoot, seedFile, sleep } from './_helpers'

const cliPath = path.join(projectRoot, 'bin', 'linesman.js')

interface ProcOutput {
  stdout: string
  stderr: string
  code: number | null
  signal: NodeJS.Signals | null
}

function spawnCli(opts: {
  cwd: string
  timeoutMs?: number
  killAfterMs?: number
}): Promise<ProcOutput & { spawned: boolean; pid: number | undefined }> {
  return new Promise((resolve) => {
    const child = spawn('node', [cliPath], {
      cwd: opts.cwd,
      env: { ...process.env, LAPS_FILE: '' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })

    const finalize = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return
      settled = true
      resolve({
        stdout,
        stderr,
        code,
        signal,
        spawned: child.pid !== undefined,
        pid: child.pid
      })
    }

    child.on('exit', (code, signal) => finalize(code, signal))
    child.on('error', () => finalize(-1, null))

    if (opts.killAfterMs !== undefined) {
      setTimeout(() => {
        if (!settled && !child.killed) {
          try {
            child.kill('SIGTERM')
          } catch {
            // ignore
          }
          setTimeout(() => {
            if (!settled && !child.killed) {
              try {
                child.kill('SIGKILL')
              } catch {
                // ignore
              }
            }
          }, 2000)
        }
      }, opts.killAfterMs)
    }

    if (opts.timeoutMs !== undefined) {
      setTimeout(() => {
        if (!settled) {
          try {
            child.kill('SIGKILL')
          } catch {
            // ignore
          }
          finalize(null, 'SIGKILL')
        }
      }, opts.timeoutMs)
    }
  })
}

test('CLI launches Electron with the discovered .laps/laps.json from a sub-subdirectory', async () => {
  test.slow()
  const tmp = makeTempLapsDir(seedFile([makeTask({ id: 'cli-001', title: 'From CLI test' })]))
  const sub = path.join(tmp.dir, 'a', 'b')
  fs.mkdirSync(sub, { recursive: true })

  try {
    const result = await spawnCli({ cwd: sub, killAfterMs: 5000, timeoutMs: 25000 })
    expect(result.spawned).toBe(true)
    expect(result.stdout).toContain(tmp.lapsFile)
    expect(result.stdout).toMatch(/linesman: using/)
    expect(typeof result.pid).toBe('number')
  } finally {
    tmp.cleanup()
  }
})

test('CLI exits with code 1 and error message when no .laps/laps.json is found', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'laps-cli-empty-'))
  try {
    const result = await spawnCli({ cwd: tmp, timeoutMs: 15000 })
    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/no \.laps\/laps\.json found/)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
    await sleep(0)
  }
})
