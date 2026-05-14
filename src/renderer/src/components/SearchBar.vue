<script setup lang="ts">
import { useLapsStore, type FilterMode } from '../stores/laps'

const store = useLapsStore()

const chips: { id: FilterMode; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'todo', label: 'Todo' },
  { id: 'done', label: 'Done' }
]
</script>

<template>
  <div class="space-y-2">
    <div class="relative">
      <svg
        class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        v-model="store.searchQuery"
        type="text"
        placeholder="Search laps..."
        class="w-full rounded-md border border-slate-800 bg-slate-900/60 py-1.5 pl-8 pr-3 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-indigo-500 focus:bg-slate-900"
      />
    </div>
    <div class="flex gap-1">
      <button
        v-for="c in chips"
        :key="c.id"
        type="button"
        class="rounded-full px-2.5 py-0.5 text-xs font-medium transition"
        :class="
          store.filterMode === c.id
            ? 'bg-indigo-500/15 text-indigo-300 ring-1 ring-inset ring-indigo-500/30'
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
        "
        @click="store.filterMode = c.id"
      >
        {{ c.label }}
      </button>
    </div>
  </div>
</template>
