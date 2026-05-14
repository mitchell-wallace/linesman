import type { LapsApi } from '../../preload/index'

declare global {
  interface Window {
    laps: LapsApi
  }
}

export {}
