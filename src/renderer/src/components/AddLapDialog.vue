<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useLapsStore } from '../stores/laps'
import type { AddPosition } from '../../../shared/types'

const props = defineProps<{
  defaultPosition?: AddPosition
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const store = useLapsStore()

const title = ref('')
const description = ref('')
const assignee = ref('')
const position = ref<AddPosition>(props.defaultPosition ?? 'tail')
const submitting = ref(false)
const error = ref<string | null>(null)
const titleInput = ref<HTMLInputElement | null>(null)

const positions: { id: AddPosition; label: string; hint: string }[] = [
  { id: 'head', label: 'Top of list', hint: 'head' },
  { id: 'tail', label: 'Bottom of list', hint: 'tail' },
  { id: 'after', label: 'After current', hint: 'after selected' }
]

async function onSubmit(): Promise<void> {
  const t = title.value.trim()
  if (t.length === 0) {
    error.value = 'Title is required'
    return
  }
  submitting.value = true
  error.value = null
  const useAfter = position.value === 'after' && store.selectedId ? store.selectedId : undefined
  const finalPos: AddPosition = position.value === 'after' && !useAfter ? 'tail' : position.value
  const result = await store.addLap(
    finalPos,
    {
      title: t,
      description: description.value,
      assignee: assignee.value.trim().length > 0 ? assignee.value.trim() : undefined
    },
    useAfter
  )
  submitting.value = false
  if (result) emit('close')
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  await nextTick()
  titleInput.value?.focus()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div
    class="fixed inset-0 z-40 flex items-start justify-center bg-slate-950/70 px-4 pt-20 backdrop-blur-sm"
    @click.self="emit('close')"
  >
    <form
      class="w-full max-w-md space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-5 shadow-2xl"
      role="dialog"
      aria-modal="true"
      @submit.prevent="onSubmit"
    >
      <div>
        <h2 class="text-sm font-semibold text-slate-100">Add a lap</h2>
        <p class="mt-0.5 text-xs text-slate-500">Saved to .laps/laps.json immediately.</p>
      </div>

      <div class="space-y-1.5">
        <label class="text-xs font-medium text-slate-400">Title</label>
        <input
          ref="titleInput"
          v-model="title"
          type="text"
          placeholder="What needs doing?"
          data-testid="add-title"
          class="w-full rounded-md border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 outline-none focus:border-indigo-500"
        />
      </div>

      <div class="space-y-1.5">
        <label class="text-xs font-medium text-slate-400">Description</label>
        <textarea
          v-model="description"
          rows="3"
          placeholder="Optional"
          data-testid="add-description"
          class="w-full resize-none rounded-md border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 outline-none focus:border-indigo-500"
        ></textarea>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="space-y-1.5">
          <label class="text-xs font-medium text-slate-400">Assignee</label>
          <input
            v-model="assignee"
            type="text"
            placeholder="Optional"
            data-testid="add-assignee"
            class="w-full rounded-md border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 outline-none focus:border-indigo-500"
          />
        </div>
        <div class="space-y-1.5">
          <label class="text-xs font-medium text-slate-400">Position</label>
          <select
            v-model="position"
            data-testid="add-position"
            class="w-full rounded-md border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-indigo-500"
          >
            <option v-for="p in positions" :key="p.id" :value="p.id">{{ p.label }}</option>
          </select>
        </div>
      </div>

      <div v-if="error" class="text-xs text-rose-400">{{ error }}</div>

      <div class="flex justify-end gap-2 pt-1">
        <button
          type="button"
          class="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
          @click="emit('close')"
        >
          Cancel
        </button>
        <button
          type="submit"
          :disabled="submitting"
          data-testid="add-submit"
          class="rounded-md bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-600 disabled:opacity-60"
        >
          {{ submitting ? 'Adding…' : 'Add lap' }}
        </button>
      </div>
    </form>
  </div>
</template>
