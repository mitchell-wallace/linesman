<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useLapsStore } from '../stores/laps'
import ConfirmModal from './ConfirmModal.vue'

const store = useLapsStore()

const selected = computed(() => store.selectedEffective)
const baseTask = computed(() => store.selectedTask)
const deletedExt = computed(() => store.deletedExternally)
const showDeleteConfirm = ref(false)

const formatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
})

function fmt(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return formatter.format(d)
}

const descRef = ref<HTMLTextAreaElement | null>(null)

function autoSizeDesc(): void {
  const el = descRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.max(el.scrollHeight, 200)}px`
}

watch(
  () => store.selectedId,
  async () => {
    await nextTick()
    autoSizeDesc()
  },
  { immediate: true }
)

watch(
  () => selected.value?.description,
  async () => {
    await nextTick()
    autoSizeDesc()
  }
)

function onTitle(e: Event): void {
  if (!store.selectedId) return
  store.patchField(store.selectedId, 'title', (e.target as HTMLInputElement).value)
}

function onDescription(e: Event): void {
  if (!store.selectedId) return
  store.patchField(store.selectedId, 'description', (e.target as HTMLTextAreaElement).value)
  autoSizeDesc()
}

function onAssignee(e: Event): void {
  if (!store.selectedId) return
  store.patchField(store.selectedId, 'assignee', (e.target as HTMLInputElement).value)
}

async function onToggleDone(e: Event): Promise<void> {
  if (!store.selectedId) return
  const v = (e.target as HTMLInputElement).checked
  await store.toggleDone(store.selectedId, v)
}

function keepEdits(): void {
  if (!store.selectedId) return
  store.keepEditorChanges(store.selectedId)
}

function discardEdits(): void {
  if (!store.selectedId) return
  store.discardEditorChanges(store.selectedId)
}

async function recover(): Promise<void> {
  await store.recoverDeleted()
}

function discardDeleted(): void {
  store.discardDeleted()
}

function requestDelete(): void {
  showDeleteConfirm.value = true
}

async function confirmDelete(): Promise<void> {
  showDeleteConfirm.value = false
  if (store.selectedId) await store.deleteLap(store.selectedId)
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div v-if="deletedExt" data-testid="deleted-banner" class="border-b border-rose-500/30 bg-rose-500/10 px-6 py-3">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div class="text-sm">
          <div class="font-medium text-rose-200">This task was deleted externally.</div>
          <div class="text-xs text-rose-300/80">
            Recover restores it (preserving your edits). Discard drops it.
          </div>
        </div>
        <div class="flex gap-2">
          <button
            type="button"
            data-testid="recover-button"
            class="rounded-md bg-rose-500/20 px-3 py-1.5 text-xs font-medium text-rose-100 ring-1 ring-rose-400/40 hover:bg-rose-500/30"
            @click="recover"
          >
            Recover
          </button>
          <button
            type="button"
            data-testid="discard-button"
            class="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
            @click="discardDeleted"
          >
            Discard
          </button>
        </div>
      </div>
    </div>

    <div
      v-else-if="store.selectedIsExternallyModified"
      data-testid="ext-banner"
      class="border-b border-amber-500/30 bg-amber-500/10 px-6 py-3"
    >
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div class="text-sm">
          <div class="font-medium text-amber-200">This task was modified externally.</div>
          <div class="text-xs text-amber-300/80">
            Keep your edits to overwrite on next save, or discard to reload from disk.
          </div>
        </div>
        <div class="flex gap-2">
          <button
            type="button"
            data-testid="keep-edits-button"
            class="rounded-md bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-100 ring-1 ring-amber-400/40 hover:bg-amber-500/30"
            @click="keepEdits"
          >
            Keep my edits
          </button>
          <button
            type="button"
            data-testid="discard-edits-button"
            class="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
            @click="discardEdits"
          >
            Discard and reload
          </button>
        </div>
      </div>
    </div>

    <div v-if="selected || deletedExt" class="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div v-if="selected" class="flex flex-1 flex-col gap-5 px-6 py-6">
        <input
          :value="selected.title"
          type="text"
          placeholder="Untitled lap"
          data-testid="editor-title"
          class="w-full border-0 bg-transparent text-2xl font-semibold leading-tight text-slate-50 placeholder:text-slate-600 outline-none focus:ring-0 px-0"
          @input="onTitle"
        />

        <div class="flex items-center gap-4">
          <label class="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              :checked="selected.isDone"
              data-testid="editor-done"
              class="h-4 w-4 cursor-pointer rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
              @change="onToggleDone"
            />
            Done
          </label>
          <div class="flex items-center gap-2">
            <label for="assignee" class="text-xs text-slate-500">Assignee</label>
            <input
              id="assignee"
              :value="selected.assignee ?? ''"
              type="text"
              placeholder="unassigned"
              data-testid="editor-assignee"
              class="w-40 rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-600 outline-none focus:border-indigo-500"
              @input="onAssignee"
            />
          </div>
        </div>

        <textarea
          ref="descRef"
          :value="selected.description"
          placeholder="Add a description…"
          spellcheck="false"
          data-testid="editor-description"
          class="min-h-[200px] w-full resize-none rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-base leading-relaxed text-slate-100 placeholder:text-slate-600 outline-none focus:border-indigo-500"
          @input="onDescription"
        ></textarea>

        <div class="mt-auto flex items-end justify-between gap-4 border-t border-slate-800/80 pt-4">
          <div class="space-y-1 text-xs text-slate-500">
            <div>
              <span class="text-slate-600">id</span>
              <span class="ml-2 font-mono text-slate-400">{{ baseTask?.id }}</span>
            </div>
            <div class="flex gap-4">
              <span>
                <span class="text-slate-600">created</span>
                <span class="ml-2 text-slate-400">{{ fmt(baseTask?.createdAt ?? null) }}</span>
              </span>
              <span>
                <span class="text-slate-600">updated</span>
                <span class="ml-2 text-slate-400">{{ fmt(baseTask?.updatedAt ?? null) }}</span>
              </span>
              <span v-if="baseTask?.completedAt">
                <span class="text-slate-600">completed</span>
                <span class="ml-2 text-slate-400">{{ fmt(baseTask.completedAt) }}</span>
              </span>
            </div>
          </div>
          <button
            type="button"
            data-testid="editor-delete"
            class="rounded-md px-2.5 py-1 text-xs font-medium text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-300"
            @click="requestDelete"
          >
            Delete lap
          </button>
        </div>
      </div>
    </div>

    <div v-else class="flex flex-1 items-center justify-center text-center">
      <div class="max-w-sm space-y-2 px-6">
        <div class="text-sm font-medium text-slate-300">No lap selected</div>
        <p class="text-xs text-slate-500">
          Pick a lap from the list, or press
          <kbd class="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-300"
            >Ctrl/Cmd&nbsp;N</kbd
          >
          to add one.
        </p>
      </div>
    </div>

    <ConfirmModal
      v-if="showDeleteConfirm"
      title="Delete this lap?"
      message="This will remove it from .laps/laps.json. This cannot be undone from the viewer."
      confirm-label="Delete"
      destructive
      @confirm="confirmDelete"
      @cancel="showDeleteConfirm = false"
    />
  </div>
</template>
