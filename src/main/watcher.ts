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
  // a spurious external-change event for our own write. If mtime/size
  // are omitted, the next poll will fall back to a full content read
  // and hash comparison (used when stat cannot be trusted, e.g. a
  // concurrent writer raced our rename).
  noteOwnWrite: (hash: string, mtimeMs?: number, size?: number) => void
  // For tests / explicit reconcile paths.
  pollNow: () => Promise<void>
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
  let lastMtime: number | null = null
  let lastSize: number | null = null
  let lastHash = ''
  let initialized = false

  const poll = async (): Promise<void> => {
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
            lastMtime = null
            lastSize = null
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
      // Short-circuit only when we have a trusted (mtime, size) baseline.
      // If either is null, the previous noteOwnWrite couldn't trust stat
      // (e.g. concurrent writer race) — force a content read this poll.
      if (
        initialized &&
        lastMtime !== null &&
        lastSize !== null &&
        mtime === lastMtime &&
        size === lastSize
      ) {
        return
      }

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
      else lastMtime = null
      if (size !== undefined) lastSize = size
      else lastSize = null
    },
    pollNow: poll
  }
}
