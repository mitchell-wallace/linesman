import { onBeforeUnmount, onMounted } from 'vue'

export interface IdleOptions {
  timeoutMs: number
  onIdle: () => void
}

export function useIdle(opts: IdleOptions): { reset: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null

  function reset(): void {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      opts.onIdle()
    }, opts.timeoutMs)
  }

  function handler(): void {
    reset()
  }

  function focusHandler(): void {
    reset()
  }

  onMounted(() => {
    window.addEventListener('keydown', handler, { capture: true })
    window.addEventListener('mousedown', handler, { capture: true })
    window.addEventListener('wheel', handler, { capture: true, passive: true })
    window.addEventListener('focus', focusHandler)
    reset()
  })

  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer)
    window.removeEventListener('keydown', handler, { capture: true } as EventListenerOptions)
    window.removeEventListener('mousedown', handler, { capture: true } as EventListenerOptions)
    window.removeEventListener('wheel', handler, { capture: true } as EventListenerOptions)
    window.removeEventListener('focus', focusHandler)
  })

  return { reset }
}
