import { ipcMain, type BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import {
  applyAdd,
  applyDelete,
  applyRecover,
  applyReorder,
  applyUpdate,
  loadFile,
  saveFile
} from './fileStore.js'
import { createWatcher, type Watcher } from './watcher.js'
import type {
  AddPosition,
  LapsFile,
  NewLapInput,
  Task,
  TaskPatch
} from '../shared/types.js'

export interface IpcContext {
  getFilePath: () => string | null
  setFilePath: (p: string | null) => void
}

let watcher: Watcher | null = null

async function noteSavedHashFromDisk(
  filePath: string,
  hash: string
): Promise<void> {
  if (!watcher) return
  try {
    const stat = await fs.stat(filePath)
    watcher.noteOwnWrite(hash, stat.mtimeMs, stat.size)
  } catch {
    watcher.noteOwnWrite(hash)
  }
}

function requirePath(ctx: IpcContext): string {
  const p = ctx.getFilePath()
  if (!p) throw new Error('no laps file is open')
  return p
}

export function registerIpc(ctx: IpcContext, win: BrowserWindow): void {
  ipcMain.handle('laps:get-file-path', () => ctx.getFilePath())

  ipcMain.handle('laps:load', async (): Promise<LapsFile> => {
    const p = requirePath(ctx)
    return loadFile(p)
  })

  ipcMain.handle(
    'laps:apply-update',
    async (_e, id: string, patch: TaskPatch): Promise<LapsFile> => {
      const p = requirePath(ctx)
      const { file, hash } = await applyUpdate(p, id, patch)
      await noteSavedHashFromDisk(p, hash)
      return file
    }
  )

  ipcMain.handle(
    'laps:apply-reorder',
    async (_e, orderedIds: string[]): Promise<LapsFile> => {
      const p = requirePath(ctx)
      const { file, hash } = await applyReorder(p, orderedIds)
      await noteSavedHashFromDisk(p, hash)
      return file
    }
  )

  ipcMain.handle(
    'laps:apply-add',
    async (
      _e,
      position: AddPosition,
      lap: NewLapInput,
      refId?: string
    ): Promise<LapsFile> => {
      const p = requirePath(ctx)
      const { file, hash } = await applyAdd(p, position, lap, refId)
      await noteSavedHashFromDisk(p, hash)
      return file
    }
  )

  ipcMain.handle(
    'laps:apply-delete',
    async (_e, id: string): Promise<LapsFile> => {
      const p = requirePath(ctx)
      const { file, hash } = await applyDelete(p, id)
      await noteSavedHashFromDisk(p, hash)
      return file
    }
  )

  ipcMain.handle(
    'laps:apply-recover',
    async (_e, lap: Task): Promise<LapsFile> => {
      const p = requirePath(ctx)
      const { file, hash } = await applyRecover(p, lap)
      await noteSavedHashFromDisk(p, hash)
      return file
    }
  )

  const initialPath = ctx.getFilePath()
  if (initialPath) startWatcher(initialPath, win)
}

export function startWatcher(filePath: string, win: BrowserWindow): void {
  stopWatcher()
  watcher = createWatcher(filePath, {
    onChange: async (content) => {
      let file: LapsFile = { version: 1, tasks: [] }
      if (content.trim().length > 0) {
        try {
          file = await loadFile(filePath)
        } catch {
          return
        }
      }
      if (!win.isDestroyed()) {
        win.webContents.send('laps:external-change', { path: filePath, file })
      }
    },
    onError: (err) => {
      console.error('[watcher]', err)
    }
  })
  watcher.start()
}

export function stopWatcher(): void {
  if (watcher) watcher.stop()
  watcher = null
}

// Re-exported so the main entry can warm the watcher with a known hash if needed.
export async function _saveAndNote(
  filePath: string,
  file: LapsFile
): Promise<LapsFile> {
  const hash = await saveFile(filePath, file)
  await noteSavedHashFromDisk(filePath, hash)
  return file
}
