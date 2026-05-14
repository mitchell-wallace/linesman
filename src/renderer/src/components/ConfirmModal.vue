<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'

const props = withDefaults(
  defineProps<{
    title: string
    message: string
    confirmLabel?: string
    cancelLabel?: string
    destructive?: boolean
  }>(),
  {
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    destructive: false
  }
)

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('cancel')
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div
    class="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm"
    @click.self="emit('cancel')"
  >
    <div
      class="w-full max-w-sm rounded-lg border border-slate-800 bg-slate-900 p-5 shadow-2xl"
      role="dialog"
      aria-modal="true"
      data-testid="confirm-modal"
    >
      <h2 class="text-sm font-semibold text-slate-100">{{ title }}</h2>
      <p class="mt-1.5 text-xs text-slate-400">{{ message }}</p>
      <div class="mt-5 flex justify-end gap-2">
        <button
          type="button"
          data-testid="confirm-no"
          class="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
          @click="emit('cancel')"
        >
          {{ props.cancelLabel }}
        </button>
        <button
          type="button"
          data-testid="confirm-yes"
          class="rounded-md px-3 py-1.5 text-xs font-medium"
          :class="
            props.destructive
              ? 'bg-rose-500 text-white hover:bg-rose-600'
              : 'bg-indigo-500 text-white hover:bg-indigo-600'
          "
          @click="emit('confirm')"
        >
          {{ props.confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>
