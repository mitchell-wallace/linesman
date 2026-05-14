<script setup lang="ts">
import { useLapsStore } from '../stores/laps'

const store = useLapsStore()

function bgFor(kind: 'info' | 'success' | 'error'): string {
  if (kind === 'error') return 'border-rose-500/40 bg-rose-500/15 text-rose-100'
  if (kind === 'success') return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-100'
  return 'border-slate-700 bg-slate-900/95 text-slate-100'
}
</script>

<template>
  <div class="pointer-events-none fixed bottom-4 right-4 z-50 flex w-72 flex-col gap-2">
    <transition-group name="toast" tag="div" class="flex flex-col gap-2">
      <div
        v-for="t in store.toasts"
        :key="t.id"
        class="pointer-events-auto rounded-md border px-3 py-2 text-xs shadow-lg backdrop-blur"
        :class="bgFor(t.kind)"
      >
        <div class="flex items-start gap-2">
          <div class="flex-1">{{ t.message }}</div>
          <button
            v-if="t.retry"
            type="button"
            class="rounded-sm bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide hover:bg-white/20"
            @click="t.retry?.()"
          >
            Retry
          </button>
          <button
            type="button"
            class="text-current opacity-60 transition hover:opacity-100"
            aria-label="Dismiss"
            @click="store.dismissToast(t.id)"
          >
            <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M6 6l12 12M6 18 18 6" />
            </svg>
          </button>
        </div>
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: opacity 200ms ease, transform 200ms ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
