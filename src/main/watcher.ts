import { promises as fs } from 'node:fs'
import { hashContent } from './fileStore.js'

export interface WatcherEvents {
  onChange: (rawContent: string) => void
  onError?: (err: unknown) => void
}

export interface Watcher {
  start: () => void
  stop: () => void
  // Call this after a programmatic save so the next poll doesn't fire
  // a spurious external-change event for our own write.
  noteOwnWrite: (hash: string, mtimeMs?: number, size?: number) => void
}

export interface WatcherOptions {
  intervalMs?: number
}

export function createWatcher(
  filePath: string,
  events: WatcherEvents,
  opts: WatcherOptions = {}
): Watcher {
  const interval = opts.intervalMs ?? 15000
  let timer: NodeJS.Timeout | null = null
  let running = false
  let lastMtime = -1
  let lastSize = -1
  let lastHash = ''
  let initialized = false

  const poll = async () => {
    if (running) return
    running = true
    try {
      let stat
      try {
        stat = await fs.stat(filePath)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          if (initialized && lastHash !== '') {
            lastHash = ''
            lastMtime = -1
            lastSize = -1
            events.onChange('')
          } else {
            initialized = true
          }
          return
        }
        throw err
      }
      const mtime = stat.mtimeMs
      const size = stat.size
      if (initialized && mtime === lastMtime && size === lastSize) return

      const content = await fs.readFile(filePath, 'utf8')
      const h = hashContent(content)
      lastMtime = mtime
      lastSize = size

      if (!initialized) {
        initialized = true
        lastHash = h
        return
      }
      if (h !== lastHash) {
        lastHash = h
        events.onChange(content)
      }
    } catch (err) {
      events.onError?.(err)
    } finally {
      running = false
    }
  }

  return {
    start() {
      if (timer) return
      void poll()
      timer = setInterval(() => {
        void poll()
      }, interval)
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    },
    noteOwnWrite(hash: string, mtimeMs?: number, size?: number) {
      lastHash = hash
      initialized = true
      if (mtimeMs !== undefined) lastMtime = mtimeMs
      if (size !== undefined) lastSize = size
    }
  }
}
