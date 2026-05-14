import { app, BrowserWindow, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import * as path from 'node:path'
import { discoverLapsFile } from './fileStore.js'
import { awaitFlush } from './flushOnQuit.js'
import { registerIpc, setQuitReadyHandler, stopWatcher } from './ipc.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const FLUSH_TIMEOUT_MS = 3000

let mainWindow: BrowserWindow | null = null
let currentFilePath: string | null = null
let isCleanQuit = false
let flushInProgress = false

function resolveInitialFilePath(): string | null {
  const env = process.env.LAPS_FILE
  if (env && env.length > 0) return path.resolve(env)
  return discoverLapsFile(process.cwd())
}

// Ask the renderer to flush any pending edits, then resolve. Resolves on
// the renderer ack or after FLUSH_TIMEOUT_MS, whichever comes first, so a
// stuck save can never trap the user in the app.
function requestFlushFromRenderer(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return Promise.resolve()
  return awaitFlush({
    sendFlushRequest: () => {
      try {
        win.webContents.send('laps:flush-and-quit')
        return true
      } catch {
        return false
      }
    },
    onQuitReady: (cb) => {
      setQuitReadyHandler(cb)
      return () => setQuitReadyHandler(null)
    },
    scheduleTimeout: (cb) => {
      const t = setTimeout(cb, FLUSH_TIMEOUT_MS)
      return () => clearTimeout(t)
    }
  })
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

  // Intercept window close so we can give the renderer a chance to flush
  // pending edits before the page is torn down.
  mainWindow.on('close', (e) => {
    const win = mainWindow
    if (!win) return
    if (isCleanQuit || flushInProgress) return
    e.preventDefault()
    flushInProgress = true
    void requestFlushFromRenderer(win).then(() => {
      isCleanQuit = true
      flushInProgress = false
      if (!win.isDestroyed()) win.close()
    })
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

// Cmd+Q on macOS (and other quit sources) bypass window 'close', so flush
// here too. Same timeout/safety as the window-close path.
app.on('before-quit', (e) => {
  stopWatcher()
  if (isCleanQuit || flushInProgress) return
  const win = mainWindow
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  e.preventDefault()
  flushInProgress = true
  void requestFlushFromRenderer(win).then(() => {
    isCleanQuit = true
    flushInProgress = false
    app.quit()
  })
})
