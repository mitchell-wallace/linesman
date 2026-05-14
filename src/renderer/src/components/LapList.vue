<script setup lang="ts">
import { computed, ref } from 'vue'
// @ts-expect-error vuedraggable lacks an accurate TS declaration
import draggable from 'vuedraggable'
import LapListItem from './LapListItem.vue'
import { useLapsStore } from '../stores/laps'
import type { Task } from '../../../shared/types'

const store = useLapsStore()

const draggingDisabled = computed(
  () => store.isFilteredOrSearched || store.syncStatus === 'syncing'
)

const localList = ref<Task[]>([])

async function onChangeEnd(): Promise<void> {
  if (draggingDisabled.value) return
  if (localList.value.length === 0) return
  const newOrder = localList.value.map((t) => t.id)
  localList.value = []
  const current = store.tasks.map((t) => t.id)
  if (newOrder.length !== current.length) return
  let same = true
  for (let i = 0; i < newOrder.length; i++) {
    if (newOrder[i] !== current[i]) {
      same = false
      break
    }
  }
  if (same) return
  await store.applyReorder(newOrder)
}
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
    <draggable
      v-if="store.filteredTasks.length > 0"
      :model-value="store.filteredTasks"
      item-key="id"
      :disabled="draggingDisabled"
      handle=".drag-handle"
      animation="160"
      ghost-class="ghost-row"
      drag-class="dragging-row"
      class="space-y-0.5"
      @update:model-value="(v: Task[]) => (localList = v)"
      @end="onChangeEnd"
    >
      <template #item="{ element }: { element: Task }">
        <LapListItem :task="element" />
      </template>
    </draggable>
    <div
      v-else-if="store.tasks.length === 0"
      class="px-2 py-6 text-center text-xs text-slate-500"
    >
      No laps yet.
    </div>
    <div v-else class="px-2 py-6 text-center text-xs text-slate-500">
      No matches.
    </div>
  </div>
</template>

<style scoped>
.ghost-row {
  opacity: 0.4;
}
.dragging-row {
  cursor: grabbing;
}
</style>
