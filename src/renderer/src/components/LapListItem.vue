<script setup lang="ts">
import { computed } from 'vue'
import { useLapsStore } from '../stores/laps'
import type { Task } from '../../../shared/types'

const props = defineProps<{
  task: Task
}>()

const store = useLapsStore()

const effective = computed<Task>(() => store.effectiveTaskFor(props.task.id) ?? props.task)
const isSelected = computed(() => store.selectedId === props.task.id)
const hasDirty = computed(() => Boolean(store.dirtyEdits[props.task.id]))
const isExternal = computed(() => store.externallyModified.has(props.task.id))

const positionInfo = computed(() => {
  const idx = store.tasks.findIndex((t) => t.id === props.task.id)
  // When a search/filter is active, the visible list is a subset of
  // store.tasks; a single move-up/down step in the underlying array can
  // produce a no-op or a confusing jump in the rendered list. Disable
  // the buttons in that case (matching how dragging is disabled in
  // LapList.vue).
  const reorderDisabled = store.isFilteredOrSearched
  return {
    idx,
    canUp: !reorderDisabled && idx > 0,
    canDown: !reorderDisabled && idx >= 0 && idx < store.tasks.length - 1
  }
})

function onCheckboxChange(e: Event): void {
  e.stopPropagation()
  const target = e.target as HTMLInputElement
  void store.toggleDone(props.task.id, target.checked)
}

function onCheckboxClick(e: Event): void {
  e.stopPropagation()
}

async function onRowClick(): Promise<void> {
  await store.select(props.task.id)
}

async function move(delta: number, e: Event): Promise<void> {
  e.stopPropagation()
  const ids = store.tasks.map((t) => t.id)
  const idx = ids.indexOf(props.task.id)
  const target = idx + delta
  if (idx < 0 || target < 0 || target >= ids.length) return
  const next = ids.slice()
  next.splice(idx, 1)
  next.splice(target, 0, props.task.id)
  await store.applyReorder(next)
}
</script>

<template>
  <div
    class="group relative flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 transition select-none"
    :class="
      isSelected
        ? 'border-indigo-500/40 bg-indigo-500/10'
        : 'border-transparent hover:border-slate-800 hover:bg-slate-900/60'
    "
    data-testid="lap-item"
    :data-lap-id="task.id"
    @click="onRowClick"
  >
    <div
      class="drag-handle flex h-5 w-3 flex-none cursor-grab items-center justify-center text-slate-600 opacity-0 transition group-hover:opacity-100 active:cursor-grabbing"
      :aria-label="`Reorder ${effective.title}`"
    >
      <svg viewBox="0 0 24 24" class="h-4 w-4" fill="currentColor" aria-hidden="true">
        <circle cx="9" cy="6" r="1.5" />
        <circle cx="15" cy="6" r="1.5" />
        <circle cx="9" cy="12" r="1.5" />
        <circle cx="15" cy="12" r="1.5" />
        <circle cx="9" cy="18" r="1.5" />
        <circle cx="15" cy="18" r="1.5" />
      </svg>
    </div>

    <input
      type="checkbox"
      :checked="effective.isDone"
      data-testid="lap-item-done"
      class="mt-0.5 h-4 w-4 flex-none cursor-pointer rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-1 focus:ring-indigo-500/50 focus:ring-offset-0"
      @click="onCheckboxClick"
      @change="onCheckboxChange"
    />

    <div class="min-w-0 flex-1">
      <div
        class="truncate text-sm leading-5"
        data-testid="lap-item-title"
        :class="
          effective.isDone
            ? 'text-slate-500 line-through'
            : 'font-medium text-slate-100'
        "
      >
        {{ effective.title || 'Untitled' }}
      </div>
      <div class="mt-0.5 flex items-center gap-1.5">
        <span class="font-mono text-[10px] tracking-tight text-slate-600 truncate">
          {{ task.id }}
        </span>
        <span
          v-if="effective.assignee"
          class="rounded-sm bg-slate-800/80 px-1 py-px text-[10px] font-medium text-slate-300"
        >
          {{ effective.assignee }}
        </span>
      </div>
    </div>

    <div class="flex flex-none items-center gap-0.5 pt-0.5">
      <button
        type="button"
        data-testid="lap-item-move-up"
        :disabled="!positionInfo.canUp"
        class="rounded-sm p-0.5 text-slate-600 opacity-0 transition hover:bg-slate-800 hover:text-slate-200 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
        :aria-label="`Move ${effective.title} up`"
        @click="(e) => move(-1, e)"
      >
        <svg viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="m6 15 6-6 6 6" />
        </svg>
      </button>
      <button
        type="button"
        data-testid="lap-item-move-down"
        :disabled="!positionInfo.canDown"
        class="rounded-sm p-0.5 text-slate-600 opacity-0 transition hover:bg-slate-800 hover:text-slate-200 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
        :aria-label="`Move ${effective.title} down`"
        @click="(e) => move(1, e)"
      >
        <svg viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <span
        v-if="isExternal"
        data-testid="lap-item-ext"
        class="ml-1 rounded-sm bg-amber-500/15 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-300"
        title="Modified externally — review in editor"
      >
        ext
      </span>
      <span
        v-else-if="hasDirty"
        data-testid="lap-item-dirty"
        class="ml-1 h-1.5 w-1.5 rounded-full bg-indigo-400"
        title="Unsaved edits"
      />
    </div>
  </div>
</template>
