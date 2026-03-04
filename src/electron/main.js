'use strict'

const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron')
const path = require('path')

/** Reference to the "Word Wrap" checkbox menu item so we can sync it from the renderer. */
let wordWrapMenuItem = null

/** References to the "Show in Lore Tree" radio items, keyed by mode value. */
let loreStatMenuItems = {}

const isDev = process.env.NODE_ENV === 'development'

// Stored once the server (or dev Vite) is ready, reused on macOS re-activate.
let serverUrl = null

/**
 * Sends a menu action string to the focused BrowserWindow's renderer process.
 * The renderer listens via window.electronAPI.onMenuAction().
 */
function sendMenuAction(action) {
  BrowserWindow.getFocusedWindow()?.webContents.send('menu-action', action)
}

/**
 * Builds and registers the native application menu.
 * Structure: [appMenu (macOS only)] File | Edit | View | Window
 */
function buildApplicationMenu() {
  wordWrapMenuItem = {
    type: 'checkbox',
    label: 'Word Wrap in Editors',
    checked: true, // default; renderer syncs the real value on startup
    click: (item) => sendMenuAction(`set-word-wrap:${item.checked}`),
  }

  for (const [mode, label] of [['none', 'Nothing'], ['words', 'Words'], ['chars', 'Characters'], ['bytes', 'Bytes']]) {
    loreStatMenuItems[mode] = {
      type: 'radio',
      label,
      checked: mode === 'words', // default; renderer syncs the real value on startup
      click: () => sendMenuAction(`set-lore-stat:${mode}`),
    }
  }

  const viewSubmenu = [
    {
      label: 'Settings',
      click: () => sendMenuAction('open-settings'),
    },
    { type: 'separator' },
    {
      label: 'Reset layouts',
      click: () => sendMenuAction('reset-layouts'),
    },
    { type: 'separator' },
    wordWrapMenuItem,
    { type: 'separator' },
    {
      label: 'Show in Lore Tree',
      submenu: Object.values(loreStatMenuItems),
    },
    { type: 'separator' },
    {
      label: 'Theme',
      submenu: [
        { label: 'Auto',            click: () => sendMenuAction('set-theme:auto') },
        { label: 'Obsidian (dark)', click: () => sendMenuAction('set-theme:obsidian') },
        { label: 'GitHub (light)',  click: () => sendMenuAction('set-theme:github') },
      ],
    },
  ]

  if (isDev) {
    viewSubmenu.push({ type: 'separator' })
    viewSubmenu.push({ role: 'toggleDevTools' })
  }

  const template = [
    // macOS: first entry is always the app menu (app name, About, Quit, etc.)
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),

    {
      label: 'File',
      submenu: [
        {
          label: 'Close Project',
          click: () => sendMenuAction('close-project'),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },

    { role: 'editMenu' },

    {
      label: 'View',
      submenu: viewSubmenu,
    },

    { role: 'windowMenu' },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
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

// In production Electron requires better-sqlite3 directly.
// If it was compiled for a different Node.js ABI, show a clear error
// instead of crashing with a cryptic native-module message.
function checkNativeDeps() {
  if (isDev) return // dev: backend runs in system Node.js via nodemon, not here
  try {
    require('better-sqlite3')
  } catch (e) {
    const { dialog } = require('electron')
    dialog.showErrorBox(
      'Native module needs rebuild',
      'better-sqlite3 was compiled for a different version of Node.js.\n\n' +
      'Run the following command and restart the application:\n\n' +
      '    npm run rebuild\n\n' +
      `Details: ${e.message}`
    )
    app.exit(1)
  }
}

// Renderer sends this to keep menu checkbox/radio in sync with localStorage state
ipcMain.on('set-menu-state', (_event, { key, value }) => {
  if (key === 'word-wrap' && wordWrapMenuItem) {
    wordWrapMenuItem.checked = value
  } else if (key === 'lore-stat') {
    for (const [mode, item] of Object.entries(loreStatMenuItems)) {
      item.checked = mode === value
    }
  }
})

app.whenReady().then(async () => {
  checkNativeDeps()
  buildApplicationMenu()

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
