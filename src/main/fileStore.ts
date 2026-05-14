import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { existsSync, statSync } from 'node:fs'
import * as path from 'node:path'
import type {
  AddPosition,
  LapsFile,
  NewLapInput,
  Task,
  TaskPatch
} from '../shared/types.js'

const ALLOWED_TASK_KEYS = new Set([
  'id',
  'title',
  'description',
  'assignee',
  'isDone',
  'createdAt',
  'updatedAt',
  'completedAt'
])

const ALLOWED_FILE_KEYS = new Set(['version', 'tasks'])

export class FileStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FileStoreError'
  }
}

export function discoverLapsFile(startDir: string): string | null {
  let dir = path.resolve(startDir)
  while (true) {
    const candidate = path.join(dir, '.laps', 'laps.json')
    if (existsSync(candidate)) {
      try {
        if (statSync(candidate).isFile()) return candidate
      } catch {
        // ignore stat failures and keep walking up
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function emptyFile(): LapsFile {
  return { version: 1, tasks: [] }
}

function validateFile(parsed: unknown, source: string): LapsFile {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new FileStoreError(`${source}: not a JSON object`)
  }
  const obj = parsed as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_FILE_KEYS.has(key)) {
      throw new FileStoreError(`${source}: unexpected field "${key}"`)
    }
  }
  if (typeof obj.version !== 'number' || !Number.isInteger(obj.version)) {
    throw new FileStoreError(`${source}: missing or invalid "version"`)
  }
  if (!Array.isArray(obj.tasks)) {
    throw new FileStoreError(`${source}: missing or invalid "tasks"`)
  }
  const tasks: Task[] = []
  for (let i = 0; i < obj.tasks.length; i++) {
    tasks.push(validateTask(obj.tasks[i], `${source}: tasks[${i}]`))
  }
  return { version: obj.version, tasks }
}

function validateTask(raw: unknown, source: string): Task {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new FileStoreError(`${source}: not an object`)
  }
  const t = raw as Record<string, unknown>
  for (const key of Object.keys(t)) {
    if (!ALLOWED_TASK_KEYS.has(key)) {
      throw new FileStoreError(`${source}: unexpected field "${key}"`)
    }
  }
  if (typeof t.id !== 'string') throw new FileStoreError(`${source}: invalid id`)
  if (typeof t.title !== 'string') throw new FileStoreError(`${source}: invalid title`)
  if (typeof t.description !== 'string') throw new FileStoreError(`${source}: invalid description`)
  if (t.assignee !== undefined && typeof t.assignee !== 'string') {
    throw new FileStoreError(`${source}: invalid assignee`)
  }
  if (typeof t.isDone !== 'boolean') throw new FileStoreError(`${source}: invalid isDone`)
  if (typeof t.createdAt !== 'string') throw new FileStoreError(`${source}: invalid createdAt`)
  if (typeof t.updatedAt !== 'string') throw new FileStoreError(`${source}: invalid updatedAt`)
  if (t.completedAt !== null && typeof t.completedAt !== 'string') {
    throw new FileStoreError(`${source}: invalid completedAt`)
  }
  const out: Task = {
    id: t.id,
    title: t.title,
    description: t.description,
    isDone: t.isDone,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    completedAt: (t.completedAt as string | null) ?? null
  }
  if (typeof t.assignee === 'string' && t.assignee.length > 0) {
    out.assignee = t.assignee
  }
  return out
}

export async function loadFile(filePath: string): Promise<LapsFile> {
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyFile()
    throw err
  }
  const trimmed = raw.trim()
  if (trimmed.length === 0 || trimmed === '{}') return emptyFile()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new FileStoreError(`${filePath}: invalid JSON: ${(err as Error).message}`)
  }
  return validateFile(parsed, filePath)
}

// Serialise matching laps' Go output exactly: 2-space indent, trailing newline,
// `assignee` omitted when empty, key order preserved per struct layout.
export function serializeFile(file: LapsFile): string {
  const ordered = {
    version: file.version,
    tasks: file.tasks.map((t) => {
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
  return JSON.stringify(ordered, null, 2) + '\n'
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

let saveCounter = 0

export async function saveFile(filePath: string, data: LapsFile): Promise<string> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const body = serializeFile(data)
  const tmp = `${filePath}.${process.pid}.${++saveCounter}.tmp`
  await fs.writeFile(tmp, body, { encoding: 'utf8', mode: 0o644 })
  try {
    await fs.rename(tmp, filePath)
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
  return hashContent(body)
}

function nowIso(): string {
  return new Date().toISOString()
}

function indexById(tasks: Task[]): Map<string, number> {
  const m = new Map<string, number>()
  for (let i = 0; i < tasks.length; i++) m.set(tasks[i].id, i)
  return m
}

export interface SaveResult {
  file: LapsFile
  hash: string
}

export async function applyUpdate(
  filePath: string,
  id: string,
  patch: TaskPatch
): Promise<SaveResult> {
  const file = await loadFile(filePath)
  const idx = file.tasks.findIndex((t) => t.id === id)
  if (idx < 0) throw new FileStoreError(`no task with id ${id}`)
  const existing = file.tasks[idx]
  const next: Task = { ...existing }
  if (patch.title !== undefined) next.title = patch.title
  if (patch.description !== undefined) next.description = patch.description
  if (patch.assignee !== undefined) {
    if (patch.assignee.length === 0) delete next.assignee
    else next.assignee = patch.assignee
  }
  if (patch.isDone !== undefined && patch.isDone !== existing.isDone) {
    next.isDone = patch.isDone
    next.completedAt = patch.isDone ? nowIso() : null
  }
  next.updatedAt = nowIso()
  file.tasks[idx] = next
  const hash = await saveFile(filePath, file)
  return { file, hash }
}

export async function applyReorder(
  filePath: string,
  orderedIds: string[]
): Promise<SaveResult> {
  const file = await loadFile(filePath)
  const byId = indexById(file.tasks)
  const seen = new Set<string>()
  const next: Task[] = []
  for (const id of orderedIds) {
    if (seen.has(id)) continue
    const idx = byId.get(id)
    if (idx === undefined) continue
    next.push(file.tasks[idx])
    seen.add(id)
  }
  for (const t of file.tasks) {
    if (!seen.has(t.id)) next.push(t)
  }
  file.tasks = next
  const hash = await saveFile(filePath, file)
  return { file, hash }
}

export async function applyAdd(
  filePath: string,
  position: AddPosition,
  lap: NewLapInput,
  refId?: string,
  repoRoot?: string
): Promise<SaveResult> {
  const file = await loadFile(filePath)
  const createdAt = lap.createdAt ?? nowIso()
  const updatedAt = lap.updatedAt ?? createdAt
  const description = lap.description ?? ''
  const existingIds = new Set(file.tasks.map((t) => t.id))
  const id =
    lap.id ??
    generateId(
      repoRoot ?? path.dirname(path.dirname(filePath)),
      lap.title,
      createdAt,
      description,
      existingIds
    )
  const task: Task = {
    id,
    title: lap.title,
    description,
    isDone: lap.isDone ?? false,
    createdAt,
    updatedAt,
    completedAt: lap.completedAt ?? null
  }
  if (lap.assignee && lap.assignee.length > 0) task.assignee = lap.assignee

  if (position === 'head') {
    file.tasks.unshift(task)
  } else if (position === 'tail') {
    file.tasks.push(task)
  } else if (position === 'after') {
    if (!refId) {
      file.tasks.push(task)
    } else {
      const idx = file.tasks.findIndex((t) => t.id === refId)
      if (idx < 0) file.tasks.push(task)
      else file.tasks.splice(idx + 1, 0, task)
    }
  }
  const hash = await saveFile(filePath, file)
  return { file, hash }
}

export async function applyDelete(filePath: string, id: string): Promise<SaveResult> {
  const file = await loadFile(filePath)
  const idx = file.tasks.findIndex((t) => t.id === id)
  if (idx >= 0) file.tasks.splice(idx, 1)
  const hash = await saveFile(filePath, file)
  return { file, hash }
}

export async function applyRecover(
  filePath: string,
  lap: Task
): Promise<SaveResult> {
  const file = await loadFile(filePath)
  if (!file.tasks.some((t) => t.id === lap.id)) {
    const restored: Task = {
      id: lap.id,
      title: lap.title,
      description: lap.description,
      isDone: lap.isDone,
      createdAt: lap.createdAt,
      updatedAt: lap.updatedAt,
      completedAt: lap.completedAt ?? null
    }
    if (lap.assignee && lap.assignee.length > 0) restored.assignee = lap.assignee
    file.tasks.push(restored)
  }
  const hash = await saveFile(filePath, file)
  return { file, hash }
}

// Mirror Go's time.Time.Format(time.RFC3339): no sub-second precision,
// timezone offset (Z for UTC).
function formatRfc3339(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const Y = d.getUTCFullYear()
  const M = pad(d.getUTCMonth() + 1)
  const D = pad(d.getUTCDate())
  const h = pad(d.getUTCHours())
  const m = pad(d.getUTCMinutes())
  const s = pad(d.getUTCSeconds())
  return `${Y}-${M}-${D}T${h}:${m}:${s}Z`
}

function normalizePrefix(name: string): string {
  let out = ''
  for (const ch of name) {
    if (/[A-Za-z0-9]/.test(ch)) {
      out += ch
      if (out.length >= 4) break
    }
  }
  out = out.toLowerCase()
  while (out.length < 4) out += 'x'
  return out
}

export function generateId(
  repoRoot: string,
  title: string,
  createdAt: string,
  description: string,
  existingIds: Set<string> | Iterable<string>
): string {
  const set = existingIds instanceof Set ? existingIds : new Set(existingIds)
  const prefix = normalizePrefix(path.basename(repoRoot))
  const desc = description.length > 200 ? description.slice(0, 200) : description
  const input = `${title}|${formatRfc3339(createdAt)}|${desc}`
  const sum = createHash('sha256').update(input, 'utf8').digest('hex')
  for (let len = 4; len <= sum.length; len++) {
    const id = `${prefix}-${sum.slice(0, len)}`
    if (!set.has(id)) return id
  }
  throw new FileStoreError('could not generate unique ID')
}
