import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { default as installExtension, REACT_DEVELOPER_TOOLS } from 'electron-devtools-installer'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** Native menu label translations. */
const MENU_STRINGS = {
  en: {
    file: 'File',
    closeProject: 'Close Project',
    view: 'View',
    settings: 'Settings',
    aiPlayground: 'AI Playground',
    resetLayouts: 'Reset layouts',
    wordWrap: 'Word Wrap in Editors',
    showInLoreTree: 'Show in Lore Tree',
    loreStat_none: 'Nothing',
    loreStat_words: 'Words',
    loreStat_chars: 'Characters',
    loreStat_bytes: 'Bytes',
    theme: 'Theme',
    theme_auto: 'Auto',
    theme_obsidian: 'Obsidian (dark)',
    theme_github: 'GitHub (light)',
    language: 'Language',
    language_en: 'English',
    language_ru: 'Русский',
  },
  ru: {
    file: 'Файл',
    closeProject: 'Закрыть проект',
    view: 'Вид',
    settings: 'Настройки',
    aiPlayground: 'Плейграунд ИИ',
    resetLayouts: 'Сбросить разметку',
    wordWrap: 'Перенос строк в редакторах',
    showInLoreTree: 'Показывать в дереве',
    loreStat_none: 'Ничего',
    loreStat_words: 'Слова',
    loreStat_chars: 'Символы',
    loreStat_bytes: 'Байты',
    theme: 'Тема',
    theme_auto: 'Авто',
    theme_obsidian: 'Obsidian (тёмная)',
    theme_github: 'GitHub (светлая)',
    language: 'Язык',
    language_en: 'English',
    language_ru: 'Русский',
  },
}

// Current toggle/radio states — kept in sync via set-menu-state IPC from the renderer.
// Used when rebuilding the menu (e.g. on locale change) so checked states are preserved.
let currentWordWrap = true
let currentLoreStat = 'words'
let currentTheme = 'auto'
let currentLocale = 'en'

/** Reference to the "Word Wrap" checkbox menu item so we can sync it from the renderer. */
let wordWrapMenuItem = null

/** References to the "Show in Lore Tree" radio items, keyed by mode value. */
let loreStatMenuItems = {}

/** References to the Theme radio items, keyed by theme value. */
let themeMenuItems = {}

/** References to the Language radio items, keyed by locale code. */
let localeMenuItems = {}

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
 * Uses currentLocale for labels and current* state for checked values.
 * Call again after a locale change to rebuild with translated labels.
 */
function buildApplicationMenu() {
  const s = MENU_STRINGS[currentLocale] ?? MENU_STRINGS.en

  wordWrapMenuItem = {
    type: 'checkbox',
    label: s.wordWrap,
    checked: currentWordWrap,
    click: (item) => sendMenuAction(`set-word-wrap:${item.checked}`),
  }

  loreStatMenuItems = {}
  for (const [mode, key] of [
    ['none', 'loreStat_none'],
    ['words', 'loreStat_words'],
    ['chars', 'loreStat_chars'],
    ['bytes', 'loreStat_bytes'],
  ]) {
    loreStatMenuItems[mode] = {
      type: 'radio',
      label: s[key],
      checked: mode === currentLoreStat,
      click: () => sendMenuAction(`set-lore-stat:${mode}`),
    }
  }

  themeMenuItems = {}
  for (const [theme, key] of [
    ['auto', 'theme_auto'],
    ['obsidian', 'theme_obsidian'],
    ['github', 'theme_github'],
  ]) {
    themeMenuItems[theme] = {
      type: 'radio',
      label: s[key],
      checked: theme === currentTheme,
      click: () => sendMenuAction(`set-theme:${theme}`),
    }
  }

  localeMenuItems = {}
  for (const [locale, key] of [
    ['en', 'language_en'],
    ['ru', 'language_ru'],
  ]) {
    localeMenuItems[locale] = {
      type: 'radio',
      label: s[key],
      checked: locale === currentLocale,
      click: () => sendMenuAction(`set-locale:${locale}`),
    }
  }

  const viewSubmenu = [
    {
      label: s.settings,
      click: () => sendMenuAction('open-settings'),
    },
    {
      label: s.aiPlayground,
      click: () => sendMenuAction('open-ai-playground'),
    },
    { type: 'separator' },
    {
      label: s.resetLayouts,
      click: () => sendMenuAction('reset-layouts'),
    },
    { type: 'separator' },
    wordWrapMenuItem,
    { type: 'separator' },
    {
      label: s.showInLoreTree,
      submenu: Object.values(loreStatMenuItems),
    },
    { type: 'separator' },
    {
      label: s.theme,
      submenu: Object.values(themeMenuItems),
    },
    {
      label: s.language,
      submenu: Object.values(localeMenuItems),
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
      label: s.file,
      submenu: [
        {
          label: s.closeProject,
          click: () => sendMenuAction('close-project'),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },

    { role: 'editMenu' },

    {
      label: s.view,
      submenu: viewSubmenu,
    },

    { role: 'windowMenu' },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow() {
  console.log('createWindow called with serverUrl:', serverUrl)
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: path.join(__dirname, 'icons/256x256.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      worldSafeExecuteJavaScript: true,
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  win.loadURL(serverUrl).catch(err => {
    console.error('Failed to load URL:', err)
  })

  if (isDev) {
    win.webContents.openDevTools()
  }

  // Open target="_blank" links in the system browser, not a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  console.log('Window created successfully')
}

// In production Electron requires better-sqlite3 directly.
// If it was compiled for a different Node.js ABI, show a clear error
// instead of crashing with a cryptic native-module message.
async function checkNativeDeps() {
  try {
    await import('better-sqlite3')
  } catch (e) {
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

// Show a native error dialog with a "Copy to Clipboard" button.
ipcMain.handle('show-error-dialog', async (event, { title, message }) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const { response } = await dialog.showMessageBox(win, {
    type: 'error',
    title,
    message,
    buttons: ['Close', 'Copy to Clipboard'],
    defaultId: 0,
    cancelId: 0,
  })
  if (response === 1) {
    clipboard.writeText(message)
  }
})

// Synchronous alert dialog
ipcMain.on('alert', (event, text) => {
  event.returnValue = dialog.showMessageBoxSync({
    message: text,
    type: 'warning',
    title: 'Alert',
  })
})

// Synchronous confirmation dialog
ipcMain.on('confirm', (event, text) => {
  event.returnValue =
    0 ==
    dialog.showMessageBoxSync({
      message: text,
      type: 'question',
      title: 'Confirm',
      buttons: ['OK', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    })
})

// Renderer sends this to keep menu checkbox/radio in sync with localStorage state
ipcMain.on('set-menu-state', (_event, { key, value }) => {
  if (key === 'word-wrap') {
    currentWordWrap = value
    if (wordWrapMenuItem) wordWrapMenuItem.checked = value
  } else if (key === 'lore-stat') {
    currentLoreStat = value
    for (const [mode, item] of Object.entries(loreStatMenuItems)) {
      item.checked = mode === value
    }
  } else if (key === 'theme') {
    currentTheme = value
    for (const [theme, item] of Object.entries(themeMenuItems)) {
      item.checked = theme === value
    }
    // Sync native window chrome (title bar, menu bar) to the selected theme.
    // Note: on Linux the window frame is controlled by the window manager and
    // nativeTheme.themeSource may not visually change the title bar.
    if (value === 'obsidian') nativeTheme.themeSource = 'dark'
    else if (value === 'github') nativeTheme.themeSource = 'light'
    else nativeTheme.themeSource = 'system'
  } else if (key === 'locale') {
    currentLocale = value
    // Rebuild entire menu so all labels appear in the new language.
    buildApplicationMenu()
  }
})

app.whenReady().then(async () => {
  console.log('Electron app is ready')
  await checkNativeDeps()
  console.log('Native deps checked')
  buildApplicationMenu()
  console.log('Application menu built')

  // Import tRPC IPC handlers instead of the old HTTP server
  const { registerIpcHandlers } = await import('../../src/backend/trpc.js')
  console.log('tRPC IPC handlers imported')
  registerIpcHandlers()
  console.log('tRPC IPC handlers registered')

  if (isDev) {
    serverUrl = 'http://localhost:3000'
    console.log('Development mode, serverUrl:', serverUrl)
    // Install React Developer Tools
    try {
      await installExtension(REACT_DEVELOPER_TOOLS, {
        loadExtensionOptions: { allowFileAccess: true },
      })
      console.log('React Developer Tools installed')
    } catch (err) {
      console.warn('Failed to install React Developer Tools:', err)
    }
  } else {
    serverUrl = `file://${path.join(app.getAppPath(), 'dist', 'index.html')}`
    console.log('Production mode, serverUrl:', serverUrl)
  }
  console.log('Creating window...')
  createWindow()
  console.log('Window created')
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
