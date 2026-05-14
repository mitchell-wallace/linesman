import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef, toRaw } from 'vue'
import type {
  AddPosition,
  LapsFile,
  NewLapInput,
  Task,
  TaskPatch
} from '../../../shared/types'

export type FilterMode = 'all' | 'todo' | 'done'
export type SyncStatus = 'idle' | 'syncing' | 'external'

export interface ToastItem {
  id: number
  kind: 'info' | 'success' | 'error'
  message: string
  retry?: () => void
}

interface PendingExternal {
  file: LapsFile
}

let toastSeq = 0

function taskEquivalent(a: Task | undefined, b: Task | undefined): boolean {
  if (!a || !b) return false
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.description === b.description &&
    (a.assignee ?? '') === (b.assignee ?? '') &&
    a.isDone === b.isDone &&
    a.createdAt === b.createdAt &&
    a.completedAt === b.completedAt
  )
}

function patchHasChanges(baseline: Task, patch: TaskPatch): boolean {
  if (patch.title !== undefined && patch.title !== baseline.title) return true
  if (patch.description !== undefined && patch.description !== baseline.description) return true
  if (patch.assignee !== undefined && patch.assignee !== (baseline.assignee ?? '')) return true
  if (patch.isDone !== undefined && patch.isDone !== baseline.isDone) return true
  return false
}

function fileSignature(f: LapsFile | null): string {
  if (!f) return ''
  // Stable ordering: version + sequence of normalised tasks. Used to skip
  // redundant external-merge work when disk matches what we just saved.
  return JSON.stringify({
    v: f.version,
    t: f.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      assignee: t.assignee ?? '',
      isDone: t.isDone,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      completedAt: t.completedAt ?? null
    }))
  })
}

function filesEqual(a: LapsFile | null, b: LapsFile | null): boolean {
  return fileSignature(a) === fileSignature(b)
}

export const useLapsStore = defineStore('laps', () => {
  const filePath = ref<string | null>(null)
  const file = shallowRef<LapsFile | null>(null)
  const selectedId = ref<string | null>(null)
  const searchQuery = ref('')
  const filterMode = ref<FilterMode>('all')
  const syncStatus = ref<SyncStatus>('idle')
  const loading = ref(true)
  const loadError = ref<string | null>(null)

  const dirtyEdits = reactive<Record<string, TaskPatch>>({})
  const dirtyBaseline = reactive<Record<string, Task>>({})
  const externallyModified = reactive<Set<string>>(new Set<string>())
  const deletedExternally = ref<Task | null>(null)
  const pendingAbandon = ref<{ targetId: string | null } | null>(null)

  const toasts = ref<ToastItem[]>([])

  const saving = ref(false)
  let queuedExternal: PendingExternal | null = null
  // Serialise saves through a single chain so two fast clicks can't fire
  // overlapping IPC calls. Each save awaits the previous one before sending,
  // which keeps the queuedExternal handling deterministic.
  let saveChain: Promise<unknown> = Promise.resolve()

  const tasks = computed<Task[]>(() => file.value?.tasks ?? [])

  const tasksById = computed<Map<string, Task>>(() => {
    const m = new Map<string, Task>()
    for (const t of tasks.value) m.set(t.id, t)
    return m
  })

  function effectiveTaskFor(id: string): Task | undefined {
    const base = tasksById.value.get(id)
    if (!base) return undefined
    const patch = dirtyEdits[id]
    if (!patch) return base
    const merged: Task = { ...base }
    if (patch.title !== undefined) merged.title = patch.title
    if (patch.description !== undefined) merged.description = patch.description
    if (patch.assignee !== undefined) {
      if (patch.assignee.length === 0) delete merged.assignee
      else merged.assignee = patch.assignee
    }
    if (patch.isDone !== undefined) merged.isDone = patch.isDone
    return merged
  }

  const filteredTasks = computed<Task[]>(() => {
    const q = searchQuery.value.trim().toLowerCase()
    const out: Task[] = []
    for (const t of tasks.value) {
      const eff = effectiveTaskFor(t.id) ?? t
      if (filterMode.value === 'todo' && eff.isDone) continue
      if (filterMode.value === 'done' && !eff.isDone) continue
      if (q.length > 0) {
        const hay = `${eff.title}\n${eff.description}`.toLowerCase()
        if (!hay.includes(q)) continue
      }
      out.push(t)
    }
    return out
  })

  const isFilteredOrSearched = computed<boolean>(
    () => searchQuery.value.trim().length > 0 || filterMode.value !== 'all'
  )

  const selectedTask = computed<Task | null>(() => {
    if (!selectedId.value) return null
    return tasksById.value.get(selectedId.value) ?? null
  })

  const selectedEffective = computed<Task | null>(() => {
    if (!selectedId.value) return null
    return effectiveTaskFor(selectedId.value) ?? null
  })

  const selectedHasPending = computed<boolean>(() => {
    if (!selectedId.value) return false
    return Boolean(dirtyEdits[selectedId.value])
  })

  const selectedIsExternallyModified = computed<boolean>(() => {
    if (!selectedId.value) return false
    return externallyModified.has(selectedId.value)
  })

  function pushToast(kind: ToastItem['kind'], message: string, retry?: () => void): number {
    const id = ++toastSeq
    toasts.value.push({ id, kind, message, retry })
    if (kind !== 'error') {
      setTimeout(() => dismissToast(id), 4000)
    }
    return id
  }

  function dismissToast(id: number): void {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  function ensureBaseline(id: string): void {
    if (!dirtyBaseline[id]) {
      const t = tasksById.value.get(id)
      if (t) dirtyBaseline[id] = { ...t }
    }
  }

  function patchField<K extends keyof TaskPatch>(id: string, key: K, value: TaskPatch[K]): void {
    ensureBaseline(id)
    const baseline = dirtyBaseline[id]
    if (!baseline) return
    const current = dirtyEdits[id] ?? {}
    const next: TaskPatch = { ...current, [key]: value }
    if (!patchHasChanges(baseline, next)) {
      delete dirtyEdits[id]
      delete dirtyBaseline[id]
      externallyModified.delete(id)
    } else {
      dirtyEdits[id] = next
    }
  }

  async function initialLoad(): Promise<void> {
    loading.value = true
    loadError.value = null
    try {
      filePath.value = await window.laps.getFilePath()
      if (!filePath.value) {
        file.value = { version: 1, tasks: [] }
        return
      }
      const loaded = await window.laps.load()
      file.value = loaded
    } catch (e) {
      loadError.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  async function runSave(fn: () => Promise<LapsFile>, errMsg: string): Promise<LapsFile | null> {
    // Chain through saveChain so concurrent callers serialise. We don't
    // let one rejection break the chain — catch on the chain head, but
    // surface the error to this caller's promise.
    const next = saveChain.then(async (): Promise<LapsFile | null> => {
      saving.value = true
      syncStatus.value = 'syncing'
      try {
        const result = await fn()
        file.value = result
        if (queuedExternal) {
          queuedExternal = null
          // The captured snapshot is stale by the time we get here (we just
          // wrote in between). Re-fetch disk truth and only merge if it
          // actually differs from what we just wrote. This guarantees the
          // renderer reflects current reality regardless of how stale the
          // queued event was.
          try {
            const fresh = await window.laps.load()
            if (!filesEqual(fresh, file.value)) {
              applyExternalFile(fresh, false)
            }
          } catch {
            // Swallow — the watcher's next poll will catch any drift.
          }
        }
        syncStatus.value = 'idle'
        return result
      } catch (e) {
        pushToast('error', `${errMsg}: ${(e as Error).message}`)
        syncStatus.value = 'idle'
        return null
      } finally {
        saving.value = false
      }
    })
    saveChain = next.catch(() => {
      // Keep the chain alive even on rejection.
    })
    return next
  }

  async function saveDirty(id: string): Promise<boolean> {
    const patch = dirtyEdits[id]
    if (!patch) return true
    const baseline = dirtyBaseline[id]
    if (!baseline) {
      delete dirtyEdits[id]
      return true
    }
    if (!patchHasChanges(baseline, patch)) {
      delete dirtyEdits[id]
      delete dirtyBaseline[id]
      externallyModified.delete(id)
      return true
    }
    const payload: TaskPatch = { ...toRaw(patch) }
    const result = await runSave(() => window.laps.applyUpdate(id, payload), "Couldn't save")
    if (!result) return false
    delete dirtyEdits[id]
    delete dirtyBaseline[id]
    externallyModified.delete(id)
    return true
  }

  async function saveAllDirty(): Promise<void> {
    const ids = Object.keys(dirtyEdits)
    for (const id of ids) {
      await saveDirty(id)
    }
  }

  async function select(id: string | null): Promise<void> {
    if (selectedId.value === id) return
    if (deletedExternally.value) {
      pendingAbandon.value = { targetId: id }
      return
    }
    const prev = selectedId.value
    if (prev && dirtyEdits[prev]) {
      await saveDirty(prev)
    }
    selectedId.value = id
  }

  async function forceSelect(id: string | null): Promise<void> {
    const prev = selectedId.value
    if (prev && dirtyEdits[prev]) {
      delete dirtyEdits[prev]
      delete dirtyBaseline[prev]
    }
    deletedExternally.value = null
    pendingAbandon.value = null
    selectedId.value = id
  }

  function cancelPendingAbandon(): void {
    pendingAbandon.value = null
  }

  async function toggleDone(id: string, value: boolean): Promise<void> {
    const result = await runSave(
      () => window.laps.applyUpdate(id, { isDone: value }),
      "Couldn't update"
    )
    if (!result) return
    const onDisk = result.tasks.find((t) => t.id === id)
    if (!onDisk) return
    const patch = dirtyEdits[id]
    if (patch) {
      if (patch.isDone !== undefined) delete patch.isDone
      dirtyBaseline[id] = { ...onDisk }
      if (!patchHasChanges(dirtyBaseline[id], patch)) {
        delete dirtyEdits[id]
        delete dirtyBaseline[id]
        externallyModified.delete(id)
      } else {
        dirtyEdits[id] = patch
      }
    }
  }

  async function applyReorder(orderedIds: string[]): Promise<void> {
    await runSave(() => window.laps.applyReorder(orderedIds), "Couldn't reorder")
  }

  async function addLap(
    position: AddPosition,
    input: NewLapInput,
    refId?: string
  ): Promise<Task | null> {
    const before = new Set(tasks.value.map((t) => t.id))
    const payload: NewLapInput = { ...toRaw(input) }
    const result = await runSave(
      () => window.laps.applyAdd(position, payload, refId),
      "Couldn't add"
    )
    if (!result) return null
    const created = result.tasks.find((t) => !before.has(t.id))
    if (created) {
      selectedId.value = created.id
    }
    return created ?? null
  }

  async function deleteLap(id: string): Promise<void> {
    delete dirtyEdits[id]
    delete dirtyBaseline[id]
    externallyModified.delete(id)
    if (selectedId.value === id) selectedId.value = null
    if (deletedExternally.value?.id === id) deletedExternally.value = null
    await runSave(() => window.laps.applyDelete(id), "Couldn't delete")
  }

  async function recoverDeleted(): Promise<void> {
    const lap = deletedExternally.value
    if (!lap) return
    const merged: Task = { ...toRaw(lap) }
    const patch = dirtyEdits[lap.id]
    if (patch) {
      if (patch.title !== undefined) merged.title = patch.title
      if (patch.description !== undefined) merged.description = patch.description
      if (patch.assignee !== undefined) {
        if (patch.assignee.length === 0) delete merged.assignee
        else merged.assignee = patch.assignee
      }
      if (patch.isDone !== undefined) merged.isDone = patch.isDone
    }
    const result = await runSave(() => window.laps.applyRecover(merged), "Couldn't recover")
    if (!result) return
    delete dirtyEdits[lap.id]
    delete dirtyBaseline[lap.id]
    externallyModified.delete(lap.id)
    deletedExternally.value = null
    selectedId.value = lap.id
  }

  function discardDeleted(): void {
    const lap = deletedExternally.value
    if (lap) {
      delete dirtyEdits[lap.id]
      delete dirtyBaseline[lap.id]
      externallyModified.delete(lap.id)
    }
    deletedExternally.value = null
    if (selectedId.value && !tasksById.value.has(selectedId.value)) {
      selectedId.value = null
    }
  }

  function discardEditorChanges(id: string): void {
    delete dirtyEdits[id]
    delete dirtyBaseline[id]
    externallyModified.delete(id)
  }

  function keepEditorChanges(id: string): void {
    externallyModified.delete(id)
    const t = tasksById.value.get(id)
    if (t) dirtyBaseline[id] = { ...t }
  }

  function applyExternalFile(next: LapsFile, viaEvent: boolean): void {
    const prevTasks = file.value?.tasks ?? []
    const prevById = new Map(prevTasks.map((t) => [t.id, t]))
    const nextById = new Map(next.tasks.map((t) => [t.id, t]))

    if (deletedExternally.value && nextById.has(deletedExternally.value.id)) {
      deletedExternally.value = null
    }

    for (const id of Object.keys(dirtyEdits)) {
      const onDisk = nextById.get(id)
      const baseline = dirtyBaseline[id]
      if (!onDisk) {
        if (selectedId.value === id) {
          deletedExternally.value = baseline ? { ...baseline } : (prevById.get(id) ?? null)
        } else {
          delete dirtyEdits[id]
          delete dirtyBaseline[id]
          externallyModified.delete(id)
        }
        continue
      }
      if (baseline && !taskEquivalent(baseline, onDisk)) {
        externallyModified.add(id)
      }
    }

    if (viaEvent) {
      const beforeIds = new Set(prevTasks.map((t) => t.id))
      const newOnes: Task[] = []
      for (const t of next.tasks) {
        if (!beforeIds.has(t.id)) newOnes.push(t)
      }
      if (newOnes.length > 0) {
        const first = newOnes[0]
        const more = newOnes.length > 1 ? ` (+${newOnes.length - 1} more)` : ''
        pushToast('info', `Added externally: ${first.title}${more}`)
      }
    }

    file.value = next

    if (selectedId.value && !nextById.has(selectedId.value) && !deletedExternally.value) {
      selectedId.value = null
    }

    if (viaEvent) {
      syncStatus.value = 'external'
      setTimeout(() => {
        if (syncStatus.value === 'external') syncStatus.value = 'idle'
      }, 1500)
    }
  }

  function handleExternalChange(nextFile: LapsFile): void {
    if (saving.value) {
      queuedExternal = { file: nextFile }
      return
    }
    applyExternalFile(nextFile, true)
  }

  return {
    filePath,
    file,
    tasks,
    tasksById,
    filteredTasks,
    isFilteredOrSearched,
    selectedId,
    selectedTask,
    selectedEffective,
    selectedHasPending,
    selectedIsExternallyModified,
    searchQuery,
    filterMode,
    syncStatus,
    loading,
    loadError,
    dirtyEdits,
    externallyModified,
    deletedExternally,
    pendingAbandon,
    toasts,
    effectiveTaskFor,
    pushToast,
    dismissToast,
    patchField,
    initialLoad,
    saveDirty,
    saveAllDirty,
    select,
    forceSelect,
    cancelPendingAbandon,
    toggleDone,
    applyReorder,
    addLap,
    deleteLap,
    recoverDeleted,
    discardDeleted,
    discardEditorChanges,
    keepEditorChanges,
    handleExternalChange
  }
})
