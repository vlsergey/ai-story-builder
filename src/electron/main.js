'use strict'

const { app, BrowserWindow, shell } = require('electron')
const path = require('path')

const isDev = process.env.NODE_ENV === 'development'

// Stored once the server (or dev Vite) is ready, reused on macOS re-activate.
let serverUrl = null

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  win.loadURL(serverUrl)

  if (isDev) {
    win.webContents.openDevTools()
  }

  // Open target="_blank" links in the system browser, not a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(async () => {
  if (isDev) {
    // In dev, Vite and Express are started externally by the dev script.
    serverUrl = 'http://localhost:3000'
  } else {
    const { startServer } = require('../backend/server')
    serverUrl = await startServer()
  }
  createWindow()
})

// Quit when all windows are closed, except on macOS where the app stays
// running in the Dock until the user quits explicitly.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Re-create a window on macOS when the Dock icon is clicked and no windows exist.
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && serverUrl) {
    createWindow()
  }
})
