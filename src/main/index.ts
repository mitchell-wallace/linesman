import { app, BrowserWindow, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import * as path from 'node:path'
import { discoverLapsFile } from './fileStore.js'
import { registerIpc, stopWatcher } from './ipc.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null
let currentFilePath: string | null = null

function resolveInitialFilePath(): string | null {
  const env = process.env.LAPS_FILE
  if (env && env.length > 0) return path.resolve(env)
  return discoverLapsFile(process.cwd())
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    titleBarStyle: 'default',
    backgroundColor: '#111111',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  registerIpc(
    {
      getFilePath: () => currentFilePath,
      setFilePath: (p) => {
        currentFilePath = p
      }
    },
    mainWindow
  )
}

app.whenReady().then(() => {
  currentFilePath = resolveInitialFilePath()
  if (currentFilePath) {
    console.log(`[laps-viewer] using file: ${currentFilePath}`)
  } else {
    console.log('[laps-viewer] no .laps/laps.json found; launching empty state')
  }
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopWatcher()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopWatcher()
})
