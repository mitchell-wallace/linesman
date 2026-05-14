import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { hashContent, serializeFile } from '../fileStore.js'
import { createWatcher } from '../watcher.js'
import type { LapsFile } from '../../shared/types.js'

const POLL_MS = 50

interface Captured {
  events: string[]
  errors: unknown[]
}

let workdir: string

beforeEach(async () => {
  workdir = await fs.mkdtemp(path.join(tmpdir(), 'laps-watcher-test-'))
})

afterEach(async () => {
  await fs.rm(workdir, { recursive: true, force: true })
})

function mkFile(suffix = ''): LapsFile {
  return {
    version: 1,
    tasks: [
      {
        id: `id-${suffix || 'a'}`,
        title: `title-${suffix}`,
        description: '',
        isDone: false,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        completedAt: null
      }
    ]
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function captureEvents(): { captured: Captured; events: { onChange: (c: string) => void; onError: (e: unknown) => void } } {
  const captured: Captured = { events: [], errors: [] }
  return {
    captured,
    events: {
      onChange: (c: string) => captured.events.push(c),
      onError: (e: unknown) => captured.errors.push(e)
    }
  }
}

describe('createWatcher', () => {
  it('fires onChange for the initial content on first poll when previously unknown', async () => {
    // Initial seed file
    const filePath = path.join(workdir, 'laps.json')
    const file = mkFile('initial')
    await fs.writeFile(filePath, serializeFile(file), 'utf8')

    const { captured, events } = captureEvents()
    const w = createWatcher(filePath, events, { intervalMs: POLL_MS })

    // Use pollNow() rather than start() so we have full control of ordering.
    await w.pollNow()
    // The watcher treats the very first observed content as the baseline
    // and does NOT fire onChange (no "previous" to compare against).
    expect(captured.events).toHaveLength(0)

    // A second poll with no changes is also a no-op.
    await w.pollNow()
    expect(captured.events).toHaveLength(0)

    w.stop()
  })

  it('fires onChange exactly once for an external write between polls', async () => {
    const filePath = path.join(workdir, 'laps.json')
    await fs.writeFile(filePath, serializeFile(mkFile('v1')), 'utf8')

    const { captured, events } = captureEvents()
    const w = createWatcher(filePath, events, { intervalMs: POLL_MS })
    await w.pollNow() // baseline
    expect(captured.events).toHaveLength(0)

    // Simulate a CLI write. mtime can be coarse on some filesystems, so
    // bump it explicitly with utimes to guarantee the watcher sees a delta.
    await sleep(20)
    const next = serializeFile(mkFile('v2'))
    await fs.writeFile(filePath, next, 'utf8')
    const now = Date.now() / 1000
    await fs.utimes(filePath, now, now + 1)

    await w.pollNow()
    expect(captured.events).toHaveLength(1)
    expect(captured.events[0]).toBe(next)

    // Subsequent polls with no further changes do nothing.
    await w.pollNow()
    expect(captured.events).toHaveLength(1)

    w.stop()
  })

  it('noteOwnWrite(hash, mtime, size) suppresses the next poll when disk matches', async () => {
    const filePath = path.join(workdir, 'laps.json')
    const content = serializeFile(mkFile('own'))
    await fs.writeFile(filePath, content, 'utf8')
    const stat = await fs.stat(filePath)

    const { captured, events } = captureEvents()
    const w = createWatcher(filePath, events, { intervalMs: POLL_MS })

    // We never call pollNow() before noteOwnWrite — simulating the "we just
    // wrote and told the watcher" path before initialization.
    w.noteOwnWrite(hashContent(content), stat.mtimeMs, stat.size)
    await w.pollNow()
    expect(captured.events).toHaveLength(0)

    w.stop()
  })

  it('regression (Fix 2): noteOwnWrite without trusted stat falls back to content comparison', async () => {
    // Models the post-fix architecture: when ipc.ts reconciles after a save,
    // it re-reads the file from disk, hashes that content, and calls
    // noteOwnWrite with the *disk* hash. If the disk's mtime/size cannot be
    // trusted (e.g. stat threw, or the reconcile path decided not to pass
    // them), the watcher must fall back to content-hash comparison on the
    // next poll instead of short-circuiting on (mtime, size).
    //
    // We simulate that here by calling noteOwnWrite WITHOUT (mtime, size),
    // then mutating the file. The next poll must read content and fire
    // onChange even though stat wasn't an explicit baseline.
    const filePath = path.join(workdir, 'laps.json')
    const initial = serializeFile(mkFile('initial'))
    await fs.writeFile(filePath, initial, 'utf8')

    const { captured, events } = captureEvents()
    const w = createWatcher(filePath, events, { intervalMs: POLL_MS })

    // Hash-only baseline (the fallback path in reconcileAfterWrite).
    w.noteOwnWrite(hashContent(initial))

    // Disk is still equal to the hash — no event should fire.
    await w.pollNow()
    expect(captured.events).toHaveLength(0)

    // Now a CLI writer mutates the file (potentially with the SAME size,
    // which is what makes the original bug subtle on a same-length write).
    await sleep(10)
    const cliWrite = serializeFile(mkFile('cli-won'))
    expect(cliWrite.length).toBe(initial.length) // sanity: same-length payload
    await fs.writeFile(filePath, cliWrite, 'utf8')

    await w.pollNow()
    expect(captured.events).toHaveLength(1)
    expect(captured.events[0]).toBe(cliWrite)

    w.stop()
  })

  it('noteOwnWrite(hash) without mtime/size forces content comparison on next poll', async () => {
    // When the reconcile path in ipc.ts fails to stat (rare but possible),
    // it calls noteOwnWrite with only a hash. The next poll must NOT
    // short-circuit on (mtime, size) — it must read the file and compare
    // hashes.
    const filePath = path.join(workdir, 'laps.json')
    const initial = serializeFile(mkFile('v1'))
    await fs.writeFile(filePath, initial, 'utf8')

    const { captured, events } = captureEvents()
    const w = createWatcher(filePath, events, { intervalMs: POLL_MS })

    // Tell watcher "we wrote this" with no stat info — so the watcher
    // can't short-circuit on (mtime, size) at all.
    w.noteOwnWrite(hashContent(initial))

    // Disk still matches the hash; nothing should fire.
    await w.pollNow()
    expect(captured.events).toHaveLength(0)

    // Now actually change disk.
    await sleep(20)
    const next = serializeFile(mkFile('v2'))
    await fs.writeFile(filePath, next, 'utf8')

    // Next poll must read content (since no trusted mtime/size baseline)
    // and detect the change.
    await w.pollNow()
    expect(captured.events).toHaveLength(1)
    expect(captured.events[0]).toBe(next)

    w.stop()
  })

  it('handles file deletion by firing onChange("")', async () => {
    const filePath = path.join(workdir, 'laps.json')
    await fs.writeFile(filePath, serializeFile(mkFile('v1')), 'utf8')

    const { captured, events } = captureEvents()
    const w = createWatcher(filePath, events, { intervalMs: POLL_MS })
    await w.pollNow() // baseline

    await fs.rm(filePath)
    await w.pollNow()
    expect(captured.events).toEqual([''])

    w.stop()
  })
})
