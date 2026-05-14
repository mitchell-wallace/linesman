import { promises as fs } from 'node:fs'
import { hashContent, loadFile } from './fileStore.js'
import type { LapsFile } from '../shared/types.js'

// Minimal watcher-shaped interface so reconcileAfterWrite can be unit-tested
// without spinning up a real polling watcher.
export interface ReconcileWatcher {
  noteOwnWrite: (hash: string, mtimeMs?: number, size?: number) => void
}

/**
 * After a save we cannot trust that the file on disk is still our write — a
 * concurrent CLI writer could have raced us between rename and stat. Re-read
 * the file, hash it, and stat that content. If it doesn't match what we
 * thought we wrote, surface the concurrent change immediately by invoking
 * onExternalChange (in production this pushes the renderer the same event
 * the watcher would have on its next poll).
 *
 * Either way we hand the *real disk hash* to the watcher so its baseline
 * matches reality.
 */
export async function reconcileAfterWriteWith(
  filePath: string,
  ourHash: string,
  watcher: ReconcileWatcher,
  onExternalChange: (file: LapsFile) => void
): Promise<void> {
  try {
    const fresh = await fs.readFile(filePath, 'utf8')
    const freshHash = hashContent(fresh)
    const stat = await fs.stat(filePath)
    watcher.noteOwnWrite(freshHash, stat.mtimeMs, stat.size)
    if (freshHash !== ourHash) {
      let parsed: LapsFile = { version: 1, tasks: [] }
      if (fresh.trim().length > 0) {
        try {
          parsed = await loadFile(filePath)
        } catch {
          // Concurrent write produced invalid JSON; the watcher's next poll
          // will keep retrying. Bail without firing a bad event.
          return
        }
      }
      onExternalChange(parsed)
    }
  } catch {
    // Reconcile failed (e.g. file vanished mid-flight). Record our hash
    // without (mtime, size) so the next poll falls back to content
    // comparison.
    watcher.noteOwnWrite(ourHash)
  }
}
