import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs, existsSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyAdd,
  applyDelete,
  applyRecover,
  applyReorder,
  applyUpdate,
  discoverLapsFile,
  FileStoreError,
  generateId,
  loadFile,
  saveFile,
  serializeFile
} from '../fileStore.js'
import type { LapsFile, Task } from '../../shared/types.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtureExpected = path.join(here, 'fixtures', 'expected.json')

let workdir: string

beforeEach(async () => {
  workdir = await fs.mkdtemp(path.join(tmpdir(), 'linesman-test-'))
})

afterEach(async () => {
  await fs.rm(workdir, { recursive: true, force: true })
})

function repoStyleDir(): { repoRoot: string; lapsDir: string; lapsFile: string } {
  const repoRoot = path.join(workdir, 'microbeads')
  const lapsDir = path.join(repoRoot, '.laps')
  return { repoRoot, lapsDir, lapsFile: path.join(lapsDir, 'laps.json') }
}

async function writeRaw(p: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, contents, 'utf8')
}

describe('discoverLapsFile', () => {
  it('finds .laps/laps.json in an ancestor', async () => {
    const { repoRoot, lapsFile } = repoStyleDir()
    await writeRaw(lapsFile, '{"version":1,"tasks":[]}\n')
    const nested = path.join(repoRoot, 'a', 'b', 'c')
    await fs.mkdir(nested, { recursive: true })
    expect(discoverLapsFile(nested)).toBe(lapsFile)
  })

  it('returns null when nothing is found', () => {
    expect(discoverLapsFile(workdir)).toBeNull()
  })
})

describe('loadFile', () => {
  it('returns an empty file for missing path', async () => {
    const f = await loadFile(path.join(workdir, 'nope.json'))
    expect(f).toEqual({ version: 1, tasks: [] })
  })

  it('treats empty or {} content as empty', async () => {
    const p1 = path.join(workdir, 'a.json')
    const p2 = path.join(workdir, 'b.json')
    await writeRaw(p1, '')
    await writeRaw(p2, '{}')
    expect(await loadFile(p1)).toEqual({ version: 1, tasks: [] })
    expect(await loadFile(p2)).toEqual({ version: 1, tasks: [] })
  })

  it('parses a real laps file', async () => {
    const text = await fs.readFile(fixtureExpected, 'utf8')
    const p = path.join(workdir, 'real.json')
    await writeRaw(p, text)
    const f = await loadFile(p)
    expect(f.version).toBe(1)
    expect(f.tasks).toHaveLength(2)
    expect(f.tasks[0].id).toBe('micr-0df3')
    expect(f.tasks[0].isDone).toBe(true)
    expect(f.tasks[1].completedAt).toBeNull()
  })

  it('rejects malformed JSON', async () => {
    const p = path.join(workdir, 'bad.json')
    await writeRaw(p, '{ not json')
    await expect(loadFile(p)).rejects.toBeInstanceOf(FileStoreError)
  })

  it('rejects unknown top-level fields', async () => {
    const p = path.join(workdir, 'extra.json')
    await writeRaw(p, '{"version":1,"tasks":[],"extra":true}')
    await expect(loadFile(p)).rejects.toBeInstanceOf(FileStoreError)
  })

  it('rejects missing version', async () => {
    const p = path.join(workdir, 'noversion.json')
    await writeRaw(p, '{"tasks":[]}')
    await expect(loadFile(p)).rejects.toBeInstanceOf(FileStoreError)
  })
})

describe('saveFile / serializeFile', () => {
  it('produces byte-for-byte match with the laps Go format', async () => {
    const expected = await fs.readFile(fixtureExpected, 'utf8')
    const file: LapsFile = {
      version: 1,
      tasks: [
        {
          id: 'micr-0df3',
          title: 'title',
          description: 'description',
          isDone: true,
          createdAt: '2026-05-01T04:08:41.090107821Z',
          updatedAt: '2026-05-01T04:09:53.815829021Z',
          completedAt: '2026-05-01T04:09:53.815829021Z'
        },
        {
          id: 'micr-40d2',
          title: 'test',
          description: '',
          isDone: false,
          createdAt: '2026-04-30T08:13:14.328915013Z',
          updatedAt: '2026-04-30T08:13:14.328915013Z',
          completedAt: null
        }
      ]
    }
    expect(serializeFile(file)).toBe(expected)

    const out = path.join(workdir, 'roundtrip.json')
    await saveFile(out, file)
    const actual = await fs.readFile(out, 'utf8')
    expect(actual).toBe(expected)
  })

  it('omits empty assignee but writes non-empty assignee', async () => {
    const file: LapsFile = {
      version: 1,
      tasks: [
        {
          id: 'a',
          title: 't',
          description: '',
          assignee: '',
          isDone: false,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          completedAt: null
        }
      ]
    }
    expect(serializeFile(file)).not.toContain('assignee')
    file.tasks[0].assignee = 'alice'
    const out = serializeFile(file)
    expect(out).toContain('"assignee": "alice"')
    // Field order: assignee after description, before isDone.
    expect(out.indexOf('"description"')).toBeLessThan(out.indexOf('"assignee"'))
    expect(out.indexOf('"assignee"')).toBeLessThan(out.indexOf('"isDone"'))
  })

  it('writes via a temp file and renames atomically', async () => {
    const out = path.join(workdir, 'atomic.json')
    const file: LapsFile = { version: 1, tasks: [] }
    await saveFile(out, file)
    expect(existsSync(out)).toBe(true)
    const stray = readdirSync(workdir).filter((n) => n.endsWith('.tmp'))
    expect(stray).toEqual([])
  })
})

describe('applyUpdate', () => {
  it('updates fields and updatedAt', async () => {
    const { lapsFile } = repoStyleDir()
    await writeRaw(
      lapsFile,
      serializeFile({
        version: 1,
        tasks: [
          {
            id: 'a',
            title: 'x',
            description: '',
            isDone: false,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            completedAt: null
          }
        ]
      })
    )
    const { file } = await applyUpdate(lapsFile, 'a', { title: 'new', isDone: true })
    expect(file.tasks[0].title).toBe('new')
    expect(file.tasks[0].isDone).toBe(true)
    expect(file.tasks[0].completedAt).not.toBeNull()
    expect(file.tasks[0].updatedAt).not.toBe('2026-01-01T00:00:00Z')
  })

  it('clears completedAt when isDone toggles back to false', async () => {
    const { lapsFile } = repoStyleDir()
    await writeRaw(
      lapsFile,
      serializeFile({
        version: 1,
        tasks: [
          {
            id: 'a',
            title: 'x',
            description: '',
            isDone: true,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            completedAt: '2026-01-02T00:00:00Z'
          }
        ]
      })
    )
    const { file } = await applyUpdate(lapsFile, 'a', { isDone: false })
    expect(file.tasks[0].isDone).toBe(false)
    expect(file.tasks[0].completedAt).toBeNull()
  })

  it('throws on unknown id', async () => {
    const { lapsFile } = repoStyleDir()
    await writeRaw(lapsFile, serializeFile({ version: 1, tasks: [] }))
    await expect(applyUpdate(lapsFile, 'nope', { title: 'x' })).rejects.toBeInstanceOf(
      FileStoreError
    )
  })
})

describe('applyReorder', () => {
  it('reorders and preserves missing ids at the end', async () => {
    const { lapsFile } = repoStyleDir()
    const mk = (id: string): Task => ({
      id,
      title: id,
      description: '',
      isDone: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      completedAt: null
    })
    await writeRaw(
      lapsFile,
      serializeFile({ version: 1, tasks: [mk('a'), mk('b'), mk('c'), mk('d')] })
    )
    const { file } = await applyReorder(lapsFile, ['c', 'a', 'ghost'])
    expect(file.tasks.map((t) => t.id)).toEqual(['c', 'a', 'b', 'd'])
  })
})

describe('applyAdd', () => {
  const mk = (id: string): Task => ({
    id,
    title: id,
    description: '',
    isDone: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    completedAt: null
  })

  it('adds at head, tail, and after', async () => {
    const { lapsFile } = repoStyleDir()
    await writeRaw(
      lapsFile,
      serializeFile({ version: 1, tasks: [mk('a'), mk('b'), mk('c')] })
    )
    const r1 = await applyAdd(lapsFile, 'head', { id: 'h', title: 'h' })
    expect(r1.file.tasks[0].id).toBe('h')
    const r2 = await applyAdd(lapsFile, 'tail', { id: 't', title: 't' })
    expect(r2.file.tasks.at(-1)?.id).toBe('t')
    const r3 = await applyAdd(lapsFile, 'after', { id: 'x', title: 'x' }, 'b')
    const ids = r3.file.tasks.map((t) => t.id)
    expect(ids.indexOf('x')).toBe(ids.indexOf('b') + 1)
  })

  it('generates a deterministic id given fixed inputs', async () => {
    const { repoRoot, lapsFile } = repoStyleDir()
    await fs.mkdir(repoRoot, { recursive: true })
    await writeRaw(lapsFile, serializeFile({ version: 1, tasks: [] }))
    const createdAt = '2026-01-01T00:00:00Z'
    const expectedId = generateId(repoRoot, 'hello', createdAt, 'desc', new Set())
    const { file } = await applyAdd(
      lapsFile,
      'tail',
      { title: 'hello', description: 'desc', createdAt, updatedAt: createdAt }
    )
    expect(file.tasks[0].id).toBe(expectedId)
  })
})

describe('applyDelete', () => {
  it('removes the task and is a no-op for missing ids', async () => {
    const { lapsFile } = repoStyleDir()
    await writeRaw(
      lapsFile,
      serializeFile({
        version: 1,
        tasks: [
          {
            id: 'a',
            title: 'a',
            description: '',
            isDone: false,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            completedAt: null
          }
        ]
      })
    )
    const { file: f1 } = await applyDelete(lapsFile, 'ghost')
    expect(f1.tasks.map((t) => t.id)).toEqual(['a'])
    const { file: f2 } = await applyDelete(lapsFile, 'a')
    expect(f2.tasks).toEqual([])
  })
})

describe('applyRecover', () => {
  it('reinserts a previously deleted lap with the same id', async () => {
    const { lapsFile } = repoStyleDir()
    await writeRaw(lapsFile, serializeFile({ version: 1, tasks: [] }))
    const lap: Task = {
      id: 'micr-dead',
      title: 'recovered',
      description: 'd',
      isDone: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      completedAt: null
    }
    const { file } = await applyRecover(lapsFile, lap)
    expect(file.tasks).toHaveLength(1)
    expect(file.tasks[0].id).toBe('micr-dead')

    const again = await applyRecover(lapsFile, lap)
    expect(again.file.tasks).toHaveLength(1)
  })
})

describe('generateId', () => {
  it('matches a precomputed sha256 prefix (Go-compatible)', () => {
    const repoRoot = '/tmp/microbeads'
    const title = 'title'
    const createdAt = '2026-05-01T04:08:41Z'
    const description = 'description'
    const input = `${title}|${createdAt}|${description}`
    const expectedHash = createHash('sha256').update(input).digest('hex')
    const id = generateId(repoRoot, title, createdAt, description, new Set())
    expect(id.startsWith('micr-')).toBe(true)
    expect(id.slice(5)).toBe(expectedHash.slice(0, 4))
  })

  it('extends the suffix on collisions', () => {
    const repoRoot = '/tmp/microbeads'
    const args = ['t', '2026-01-01T00:00:00Z', 'd'] as const
    const first = generateId(repoRoot, args[0], args[1], args[2], new Set())
    const second = generateId(repoRoot, args[0], args[1], args[2], new Set([first]))
    expect(second).not.toBe(first)
    expect(second.startsWith('micr-')).toBe(true)
    expect(second.length).toBeGreaterThan(first.length)
  })

  it('pads short prefixes with x', () => {
    const repoRoot = '/tmp/ab'
    const id = generateId(repoRoot, 't', '2026-01-01T00:00:00Z', '', new Set())
    expect(id.startsWith('abxx-')).toBe(true)
  })
})

describe('save atomicity', () => {
  it('rename leaves only the final file', async () => {
    const out = path.join(workdir, 'atomic2.json')
    const file: LapsFile = {
      version: 1,
      tasks: [
        {
          id: 'a',
          title: 'a',
          description: '',
          isDone: false,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          completedAt: null
        }
      ]
    }
    await Promise.all([saveFile(out, file), saveFile(out, file), saveFile(out, file)])
    const names = readdirSync(workdir)
    expect(names.filter((n) => n.endsWith('.tmp'))).toEqual([])
    expect(names).toContain('atomic2.json')
  })
})
