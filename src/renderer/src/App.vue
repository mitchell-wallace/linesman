<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { LapsFile, Task } from '../../shared/types'

const filePath = ref<string | null>(null)
const tasks = ref<Task[]>([])
const version = ref<number>(1)
const error = ref<string | null>(null)
const loading = ref(true)

async function refresh(): Promise<void> {
  try {
    filePath.value = await window.laps.getFilePath()
    if (!filePath.value) {
      tasks.value = []
      loading.value = false
      return
    }
    const file: LapsFile = await window.laps.load()
    version.value = file.version
    tasks.value = file.tasks
    error.value = null
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

let unsubscribe: (() => void) | null = null

onMounted(async () => {
  await refresh()
  unsubscribe = window.laps.onExternalChange((evt) => {
    version.value = evt.file.version
    tasks.value = evt.file.tasks
  })
})

onBeforeUnmount(() => {
  unsubscribe?.()
})
</script>

<template>
  <div class="min-h-full p-6 font-sans">
    <header class="mb-6">
      <h1 class="text-xl font-semibold">laps-viewer</h1>
      <p class="text-sm text-neutral-400 break-all">
        {{ filePath ?? 'no .laps/laps.json found' }}
      </p>
    </header>

    <div v-if="loading" class="text-neutral-400 text-sm">loading...</div>
    <div v-else-if="error" class="text-red-400 text-sm">{{ error }}</div>
    <div v-else-if="!filePath" class="text-neutral-400 text-sm">
      Run this from a directory that contains a <code>.laps/laps.json</code> file.
    </div>
    <ul v-else class="space-y-2">
      <li
        v-for="t in tasks"
        :key="t.id"
        class="rounded border border-neutral-800 p-3 bg-neutral-900"
      >
        <div class="flex items-center gap-3">
          <span
            class="inline-block w-2 h-2 rounded-full"
            :class="t.isDone ? 'bg-emerald-500' : 'bg-neutral-500'"
          />
          <span class="font-mono text-xs text-neutral-500">{{ t.id }}</span>
          <span class="font-medium">{{ t.title }}</span>
        </div>
        <div v-if="t.description" class="mt-1 text-sm text-neutral-400">
          {{ t.description }}
        </div>
      </li>
      <li v-if="tasks.length === 0" class="text-neutral-500 text-sm">
        no tasks yet
      </li>
    </ul>
  </div>
</template>
