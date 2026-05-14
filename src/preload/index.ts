import { contextBridge, ipcRenderer } from 'electron'
import type {
  AddPosition,
  ExternalChangeEvent,
  LapsFile,
  NewLapInput,
  Task,
  TaskPatch
} from '../shared/types.js'

const api = {
  getFilePath: (): Promise<string | null> => ipcRenderer.invoke('laps:get-file-path'),
  load: (): Promise<LapsFile> => ipcRenderer.invoke('laps:load'),
  applyUpdate: (id: string, patch: TaskPatch): Promise<LapsFile> =>
    ipcRenderer.invoke('laps:apply-update', id, patch),
  applyReorder: (orderedIds: string[]): Promise<LapsFile> =>
    ipcRenderer.invoke('laps:apply-reorder', orderedIds),
  applyAdd: (position: AddPosition, lap: NewLapInput, refId?: string): Promise<LapsFile> =>
    ipcRenderer.invoke('laps:apply-add', position, lap, refId),
  applyDelete: (id: string): Promise<LapsFile> =>
    ipcRenderer.invoke('laps:apply-delete', id),
  applyRecover: (lap: Task): Promise<LapsFile> =>
    ipcRenderer.invoke('laps:apply-recover', lap),
  onExternalChange: (cb: (e: ExternalChangeEvent) => void): (() => void) => {
    const handler = (_: unknown, payload: ExternalChangeEvent) => cb(payload)
    ipcRenderer.on('laps:external-change', handler)
    return () => ipcRenderer.removeListener('laps:external-change', handler)
  },
  onFlushAndQuit: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('laps:flush-and-quit', handler)
    return () => ipcRenderer.removeListener('laps:flush-and-quit', handler)
  },
  notifyQuitReady: (): void => {
    ipcRenderer.send('laps:quit-ready')
  }
}

export type LapsApi = typeof api

contextBridge.exposeInMainWorld('laps', api)
