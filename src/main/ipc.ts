import { ipcMain, type BrowserWindow } from 'electron'
import {
  applyAdd,
  applyDelete,
  applyRecover,
  applyReorder,
  applyUpdate,
  loadFile,
  saveFile
} from './fileStore.js'
import { reconcileAfterWriteWith } from './reconcile.js'
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
let activeWindow: BrowserWindow | null = null

async function reconcileAfterWrite(
  filePath: string,
  ourHash: string
): Promise<void> {
  if (!watcher) return
  await reconcileAfterWriteWith(filePath, ourHash, watcher, (parsed) => {
    if (activeWindow && !activeWindow.isDestroyed()) {
      activeWindow.webContents.send('laps:external-change', {
        path: filePath,
        file: parsed
      })
    }
  })
}

function requirePath(ctx: IpcContext): string {
  const p = ctx.getFilePath()
  if (!p) throw new Error('no laps file is open')
  return p
}

export function registerIpc(ctx: IpcContext, win: BrowserWindow): void {
  activeWindow = win

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
      await reconcileAfterWrite(p, hash)
      return file
    }
  )

  ipcMain.handle(
    'laps:apply-reorder',
    async (_e, orderedIds: string[]): Promise<LapsFile> => {
      const p = requirePath(ctx)
      const { file, hash } = await applyReorder(p, orderedIds)
      await reconcileAfterWrite(p, hash)
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
      await reconcileAfterWrite(p, hash)
      return file
    }
  )

  ipcMain.handle(
    'laps:apply-delete',
    async (_e, id: string): Promise<LapsFile> => {
      const p = requirePath(ctx)
      const { file, hash } = await applyDelete(p, id)
      await reconcileAfterWrite(p, hash)
      return file
    }
  )

  ipcMain.handle(
    'laps:apply-recover',
    async (_e, lap: Task): Promise<LapsFile> => {
      const p = requirePath(ctx)
      const { file, hash } = await applyRecover(p, lap)
      await reconcileAfterWrite(p, hash)
      return file
    }
  )

  ipcMain.on('laps:quit-ready', () => {
    quitReadyHandler?.()
  })

  const initialPath = ctx.getFilePath()
  if (initialPath) startWatcher(initialPath, win)
}

let quitReadyHandler: (() => void) | null = null
export function setQuitReadyHandler(h: (() => void) | null): void {
  quitReadyHandler = h
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
  await reconcileAfterWrite(filePath, hash)
  return file
}
