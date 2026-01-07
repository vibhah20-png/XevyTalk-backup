const { app, BrowserWindow, shell, Menu } = require('electron')
const path = require('path')

const isDev = !app.isPackaged
let serverProcess = null

function startServer() {
  // In dev mode, the server is started separately via npm run dev
  if (isDev) {
    console.log('Dev mode: Skipping embedded server start')
    return
  }
  const { spawn } = require('child_process')
  const SERVER_PATH = isDev
    ? path.join(__dirname, '../backend/src/index.js')
    : path.join(process.resourcesPath, 'backend/src/index.js')

  console.log('Starting server from:', SERVER_PATH)

  serverProcess = spawn('node', [SERVER_PATH], {
    env: { ...process.env, PORT: '4000' },
    cwd: isDev
      ? path.join(__dirname, '../backend')
      : path.join(process.resourcesPath, 'backend')
  })

  serverProcess.stdout.on('data', (data) => {
    console.log(`Server: ${data}`)
  })

  serverProcess.stderr.on('data', (data) => {
    console.error(`Server Error: ${data}`)
  })

  serverProcess.on('error', (err) => {
    console.error('Failed to start server:', err)
  })

  serverProcess.on('exit', (code) => {
    console.log(`Server exited with code ${code}`)
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 400,
    minHeight: 500,
    title: 'XevyTalk',
    backgroundColor: '#f0f9ff',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  })
  // Remove native app menu entirely
  Menu.setApplicationMenu(null)

  if (isDev) {
    win.loadURL('http://13.205.101.250:5173')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.resolve(__dirname, '..', 'frontend', 'dist', 'index.html'))
    // Temporarily open DevTools to debug
    win.webContents.openDevTools({ mode: 'detach' })
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(() => {
  startServer()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  if (serverProcess) {
    serverProcess.kill()
  }
})
