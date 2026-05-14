<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useLapsStore } from './stores/laps'
import { useIdle } from './composables/useIdle'
import SearchBar from './components/SearchBar.vue'
import LapList from './components/LapList.vue'
import LapEditor from './components/LapEditor.vue'
import AddLapDialog from './components/AddLapDialog.vue'
import ConfirmModal from './components/ConfirmModal.vue'
import Toasts from './components/Toasts.vue'
import type { AddPosition } from '../../shared/types'

const store = useLapsStore()

const showAdd = ref(false)
const addPosition = ref<AddPosition>('tail')

const filePathDisplay = computed(() => store.filePath ?? 'No file open')

const syncLabel = computed(() => {
  if (store.syncStatus === 'syncing') return 'Syncing…'
  if (store.syncStatus === 'external') return 'External update applied'
  return 'Synced'
})

const syncDotClass = computed(() => {
  if (store.syncStatus === 'syncing') return 'bg-indigo-400 animate-pulse'
  if (store.syncStatus === 'external') return 'bg-amber-400'
  return 'bg-emerald-400'
})

let unsubExternal: (() => void) | null = null

useIdle({
  timeoutMs: 30000,
  onIdle: () => {
    void store.saveAllDirty()
  }
})

function openAdd(pos: AddPosition = 'tail'): void {
  addPosition.value = pos
  showAdd.value = true
}

function confirmAbandon(): void {
  const target = store.pendingNavigation?.targetId ?? null
  store.discardDeleted()
  void store.forceSelect(target)
}

function cancelAbandon(): void {
  store.cancelPendingNavigation()
}

function onWindowKey(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
    const target = e.target as HTMLElement | null
    const tag = target?.tagName ?? ''
    if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
    e.preventDefault()
    openAdd('tail')
  }
}

onMounted(async () => {
  await store.initialLoad()
  unsubExternal = window.laps.onExternalChange((evt) => {
    store.handleExternalChange(evt.file)
  })
  window.addEventListener('keydown', onWindowKey)
  window.addEventListener('beforeunload', () => {
    void store.saveAllDirty()
  })
})

onBeforeUnmount(() => {
  unsubExternal?.()
  window.removeEventListener('keydown', onWindowKey)
  void store.saveAllDirty()
})
</script>

<template>
  <div class="flex h-full flex-col bg-slate-950 text-slate-100">
    <header
      class="flex flex-none items-center justify-between gap-4 border-b border-slate-800/80 bg-slate-900/40 px-4 py-2.5"
    >
      <div class="flex min-w-0 items-center gap-3">
        <div class="flex items-center gap-2">
          <div class="h-6 w-6 rounded bg-indigo-500/15 ring-1 ring-inset ring-indigo-500/30">
            <svg viewBox="0 0 24 24" class="h-full w-full p-1 text-indigo-300" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 12h14M5 6h14M5 18h9" />
            </svg>
          </div>
          <span class="text-sm font-semibold tracking-tight">laps-viewer</span>
        </div>
        <span class="text-slate-700">·</span>
        <div
          class="min-w-0 truncate font-mono text-xs text-slate-500"
          data-testid="file-path"
          :title="store.filePath ?? ''"
        >
          {{ filePathDisplay }}
        </div>
      </div>

      <div class="flex flex-none items-center gap-3 text-xs">
        <div class="flex items-center gap-1.5" data-testid="sync-status" :title="`Sync status: ${syncLabel}`">
          <span class="h-1.5 w-1.5 rounded-full transition-colors" :class="syncDotClass" />
          <span class="text-slate-400">{{ syncLabel }}</span>
        </div>
        <span class="hidden text-slate-700 sm:inline">·</span>
        <span class="hidden text-slate-500 sm:inline">
          <kbd class="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">Ctrl/Cmd&nbsp;N</kbd>
          to add
        </span>
      </div>
    </header>

    <div v-if="store.loading" class="flex flex-1 items-center justify-center text-xs text-slate-500">
      Loading…
    </div>
    <div
      v-else-if="store.loadError"
      class="flex flex-1 items-center justify-center text-sm text-rose-300"
    >
      {{ store.loadError }}
    </div>
    <div
      v-else-if="!store.filePath"
      data-testid="no-file"
      class="flex flex-1 items-center justify-center px-6 text-center"
    >
      <div class="max-w-md space-y-3">
        <div class="text-lg font-semibold text-slate-200">No laps.json found</div>
        <p class="text-sm text-slate-400">
          Launch laps-viewer from a directory that contains a
          <code class="rounded bg-slate-800 px-1 py-px font-mono text-xs">.laps/laps.json</code>
          file, or set
          <code class="rounded bg-slate-800 px-1 py-px font-mono text-xs">LAPS_FILE</code>
          to an explicit path.
        </p>
      </div>
    </div>
    <div
      v-else-if="store.tasks.length === 0"
      class="flex flex-1 items-center justify-center px-6 text-center"
    >
      <div class="max-w-sm space-y-4">
        <div class="space-y-1">
          <div class="text-lg font-semibold text-slate-200">No laps yet</div>
          <p class="text-sm text-slate-400">Add your first task to get started.</p>
        </div>
        <button
          type="button"
          data-testid="add-lap-button"
          class="rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-600"
          @click="openAdd('tail')"
        >
          Add your first task
        </button>
      </div>
    </div>

    <div v-else class="flex min-h-0 flex-1">
      <aside class="flex w-[360px] flex-none flex-col border-r border-slate-800/80 bg-slate-900/30">
        <div class="flex-none border-b border-slate-800/80 px-3 py-3">
          <SearchBar />
        </div>
        <LapList />
        <div class="flex-none border-t border-slate-800/80 p-2">
          <button
            type="button"
            data-testid="add-lap-button"
            class="flex w-full items-center justify-center gap-1.5 rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-600"
            @click="openAdd('tail')"
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add lap
          </button>
        </div>
      </aside>

      <main class="flex min-w-0 flex-1 flex-col">
        <LapEditor />
      </main>
    </div>

    <AddLapDialog
      v-if="showAdd"
      :default-position="addPosition"
      @close="showAdd = false"
    />

    <ConfirmModal
      v-if="store.pendingNavigation"
      title="Abandon this deleted task?"
      message="Your edits will be lost."
      confirm-label="Abandon"
      cancel-label="Stay here"
      destructive
      @confirm="confirmAbandon"
      @cancel="cancelAbandon"
    />

    <Toasts />
  </div>
</template>
