import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { hashContent, serializeFile } from '../fileStore.js'
import { reconcileAfterWriteWith, type ReconcileWatcher } from '../reconcile.js'
import type { LapsFile } from '../../shared/types.js'

let workdir: string

beforeEach(async () => {
  workdir = await fs.mkdtemp(path.join(tmpdir(), 'laps-reconcile-test-'))
})

afterEach(async () => {
  await fs.rm(workdir, { recursive: true, force: true })
})

function mkFile(suffix: string): LapsFile {
  return {
    version: 1,
    tasks: [
      {
        id: 'a',
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

interface Recorder {
  watcher: ReconcileWatcher
  noteCalls: Array<{ hash: string; mtimeMs?: number; size?: number }>
  external: LapsFile[]
}

function recorder(): Recorder {
  const r: Recorder = {
    watcher: {
      noteOwnWrite: () => {}
    },
    noteCalls: [],
    external: []
  }
  r.watcher.noteOwnWrite = (hash, mtimeMs, size) => {
    r.noteCalls.push({ hash, mtimeMs, size })
  }
  return r
}

describe('reconcileAfterWriteWith', () => {
  it('no concurrent write: records disk hash with stat and does NOT fire onExternalChange', async () => {
    const filePath = path.join(workdir, 'laps.json')
    const content = serializeFile(mkFile('ours'))
    await fs.writeFile(filePath, content, 'utf8')
    const ourHash = hashContent(content)

    const r = recorder()
    await reconcileAfterWriteWith(filePath, ourHash, r.watcher, (f) => r.external.push(f))

    expect(r.external).toEqual([])
    expect(r.noteCalls).toHaveLength(1)
    expect(r.noteCalls[0].hash).toBe(ourHash)
    expect(typeof r.noteCalls[0].mtimeMs).toBe('number')
    expect(typeof r.noteCalls[0].size).toBe('number')
  })

  it('regression (Fix 2): concurrent CLI write detected -> fires onExternalChange with disk content + records DISK hash', async () => {
    // Simulate the exact race: we believed we wrote `ourContent`, but by
    // the time reconcile runs the disk actually holds `cliContent`. The
    // helper must:
    //   1. Hand the disk's hash (not ours) to the watcher, so its baseline
    //      matches reality and a future poll won't fire a redundant event.
    //   2. Fire onExternalChange with the disk content, immediately, so the
    //      renderer can merge — without waiting for the next 15s poll.
    const filePath = path.join(workdir, 'laps.json')
    const ourContent = serializeFile(mkFile('ours'))
    const ourHash = hashContent(ourContent)

    // Disk actually contains CLI's write.
    const cliContent = serializeFile(mkFile('cli'))
    await fs.writeFile(filePath, cliContent, 'utf8')

    const r = recorder()
    await reconcileAfterWriteWith(filePath, ourHash, r.watcher, (f) => r.external.push(f))

    expect(r.external).toHaveLength(1)
    expect(r.external[0].tasks[0].title).toBe('title-cli')
    expect(r.noteCalls).toHaveLength(1)
    expect(r.noteCalls[0].hash).toBe(hashContent(cliContent))
  })

  it('disk read failure: records our hash WITHOUT mtime/size (forces next-poll content compare)', async () => {
    const filePath = path.join(workdir, 'never-existed.json')
    const ourHash = hashContent('whatever')

    const r = recorder()
    await reconcileAfterWriteWith(filePath, ourHash, r.watcher, (f) => r.external.push(f))

    expect(r.external).toEqual([])
    expect(r.noteCalls).toHaveLength(1)
    expect(r.noteCalls[0].hash).toBe(ourHash)
    expect(r.noteCalls[0].mtimeMs).toBeUndefined()
    expect(r.noteCalls[0].size).toBeUndefined()
  })

  it('concurrent write of invalid JSON: records disk hash, does NOT fire external event', async () => {
    const filePath = path.join(workdir, 'laps.json')
    await fs.writeFile(filePath, '{ not valid', 'utf8')

    const ourHash = hashContent('something-else')

    const r = recorder()
    await reconcileAfterWriteWith(filePath, ourHash, r.watcher, (f) => r.external.push(f))

    // No external event (we don't want to push garbage to the renderer).
    expect(r.external).toEqual([])
    // Hash baseline still gets updated so the watcher won't spam.
    expect(r.noteCalls).toHaveLength(1)
  })
})
