import EventEmitter from "node:events"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { app, BrowserWindow, dialog, Menu, type MenuItemConstructorOptions, nativeTheme, shell } from "electron"
import z from "zod"
import type { BackToFrontMenuAction } from "../shared/back-to-front-menu-actions.js"
import { DISPLAY_TEXT_STAT_MODE_VALUES, type DisplayTextStatMode } from "../shared/DisplayTextStatMode.js"
import { DEFAULT_LOCALE, LOCALE_VALUES, type Locale } from "../shared/locales.js"
import { THEME_PREFERENCE_VALUES, THEME_TO_MODE, type ThemePreference } from "../shared/themes.js"
import { emitterToSingleArgObservable } from "./lib/event-manager.js"
import { appRouter, type RouteBuilder } from "./router.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** Native menu label translations. */
const MENU_STRINGS = {
  en: {
    file: "File",
    closeProject: "Close Project",
    exportProjectAsTemplate: "Export as template...",
    view: "View",
    settings: "Settings",
    resetLayouts: "Reset layouts",
    wordWrap: "Word Wrap in Editors",
    showInLoreTree: "Show in Lore Tree",
    loreStat_none: "Nothing",
    loreStat_words: "Words",
    loreStat_chars: "Characters",
    loreStat_bytes: "Bytes",
    theme: "Theme",
    theme_auto: "Auto",
    theme_obsidian: "Obsidian (dark)",
    theme_github: "GitHub (light)",
    language: "Language",
    language_en: "English",
    language_ru: "Русский",
  },
  ru: {
    file: "Файл",
    closeProject: "Закрыть проект",
    exportProjectAsTemplate: "Экспортировать как шаблон...",
    view: "Вид",
    settings: "Настройки",
    resetLayouts: "Сбросить разметку",
    wordWrap: "Перенос строк в редакторах",
    showInLoreTree: "Показывать в дереве",
    loreStat_none: "Ничего",
    loreStat_words: "Слова",
    loreStat_chars: "Символы",
    loreStat_bytes: "Байты",
    theme: "Тема",
    theme_auto: "Авто",
    theme_obsidian: "Obsidian (тёмная)",
    theme_github: "GitHub (светлая)",
    language: "Язык",
    language_en: "English",
    language_ru: "Русский",
  },
}

// Current toggle/radio states — kept in sync via set-menu-state IPC from the renderer.
// Used when rebuilding the menu (e.g. on locale change) so checked states are preserved.
let currentWordWrap = true
let currentLoreStat: DisplayTextStatMode = "words"
let currentTheme: ThemePreference = "auto"
let currentLocale: Locale = DEFAULT_LOCALE

/** Reference to the "Word Wrap" checkbox menu item so we can sync it from the renderer. */
let wordWrapMenuItem: MenuItemConstructorOptions = {}

/** References to the "Show in Lore Tree" radio items, keyed by mode value. */
let loreStatMenuItems: Record<string, MenuItemConstructorOptions> = {}

/** References to the Theme radio items, keyed by theme value. */
let themeMenuItems: Record<string, MenuItemConstructorOptions> = {}

/** References to the Language radio items, keyed by locale code. */
let localeMenuItems: Record<string, MenuItemConstructorOptions> = {}

const isDev = process.env.NODE_ENV === "development"

// Stored once the server (or dev Vite) is ready, reused on macOS re-activate.
let serverUrl: string | null = null

interface MenuStateEvents {
  backToFrontMenuAction: [BackToFrontMenuAction]
  loreStat: [DisplayTextStatMode]
  locale: [Locale]
  theme: [ThemePreference]
  wordWrap: [boolean]
}

const menuEventsEmitter = new EventEmitter<MenuStateEvents>()

/**
 * Builds and registers the native application menu.
 * Uses currentLocale for labels and current* state for checked values.
 * Call again after a locale change to rebuild with translated labels.
 */
function buildApplicationMenu() {
  const s = MENU_STRINGS[currentLocale] ?? MENU_STRINGS.en

  wordWrapMenuItem = {
    type: "checkbox",
    label: s.wordWrap,
    checked: currentWordWrap,
    click: (item) => menuEventsEmitter.emit("wordWrap", item.checked),
  }

  loreStatMenuItems = {}
  for (const mode of DISPLAY_TEXT_STAT_MODE_VALUES) {
    loreStatMenuItems[mode] = {
      type: "radio",
      label: s[`loreStat_${mode}` as keyof typeof s],
      checked: mode === currentLoreStat,
      click: () => menuEventsEmitter.emit("loreStat", mode),
    }
  }

  themeMenuItems = {}
  for (const theme of THEME_PREFERENCE_VALUES) {
    themeMenuItems[theme] = {
      type: "radio",
      label: s[`theme_${theme}` as keyof typeof s],
      checked: theme === currentTheme,
      click: () => menuEventsEmitter.emit("theme", theme),
    }
  }

  localeMenuItems = {}
  for (const locale of LOCALE_VALUES) {
    localeMenuItems[locale] = {
      type: "radio",
      label: s[`language_${locale}` as keyof typeof s],
      checked: locale === currentLocale,
      click: () => menuEventsEmitter.emit("locale", locale),
    }
  }

  const viewSubmenu: MenuItemConstructorOptions[] = [
    {
      label: s.settings,
      click: () => menuEventsEmitter.emit("backToFrontMenuAction", "open-settings"),
    },
    { type: "separator" },
    {
      label: s.resetLayouts,
      click: () => menuEventsEmitter.emit("backToFrontMenuAction", "reset-layouts"),
    },
    { type: "separator" },
    wordWrapMenuItem,
    { type: "separator" },
    {
      label: s.showInLoreTree,
      submenu: Object.values(loreStatMenuItems),
    },
    { type: "separator" },
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
    viewSubmenu.push({ type: "separator" })
    viewSubmenu.push({ role: "toggleDevTools" })
  }

  const template: MenuItemConstructorOptions[] = [
    // macOS: first entry is always the app menu (app name, About, Quit, etc.)
    ...(process.platform === "darwin"
      ? [{ role: "appMenu" } as MenuItemConstructorOptions]
      : ([] as MenuItemConstructorOptions[])),

    {
      label: s.file,
      submenu: [
        {
          label: s.exportProjectAsTemplate,
          click: () => menuEventsEmitter.emit("backToFrontMenuAction", "export-project-as-template"),
        },
        { type: "separator" },
        {
          label: s.closeProject,
          click: () => menuEventsEmitter.emit("backToFrontMenuAction", "close-project"),
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },

    { role: "editMenu" },

    {
      label: s.view,
      submenu: viewSubmenu,
    },

    { role: "windowMenu" },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow() {
  console.log("createWindow called with serverUrl: ", serverUrl)
  console.log("Loading preload script: ", path.join(__dirname, "../preload/preload.cjs"))
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: path.join(__dirname, "icons/256x256.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, "../preload/preload.cjs"),
    },
  })

  if (serverUrl) {
    win.loadURL(serverUrl).catch((err) => {
      console.error("Failed to load URL:", err)
    })
  } else {
    console.error("No server URL provided")
  }

  if (isDev) {
    win.webContents.openDevTools()
  }

  // Open target="_blank" links in the system browser, not a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: "deny" }
  })

  console.log("Window created successfully")
  return win
}

// In production Electron requires better-sqlite3 directly.
// If it was compiled for a different Node.js ABI, show a clear error
// instead of crashing with a cryptic native-module message.
async function checkNativeDeps() {
  try {
    await import("better-sqlite3")
  } catch (e: any) {
    dialog.showErrorBox(
      "Native module needs rebuild",
      "better-sqlite3 was compiled for a different version of Node.js.\n\n" +
        "Run the following command and restart the application:\n\n" +
        "    npm run rebuild\n\n" +
        `Details: ${e.message}`,
    )
    app.exit(1)
  }
}

export function menuStateRoutes(t: RouteBuilder) {
  return t.router({
    backToFrontMenuActions: t.router({
      subscribe: t.procedure.subscription(() =>
        emitterToSingleArgObservable(menuEventsEmitter, "backToFrontMenuAction"),
      ),
    }),
    locale: t.router({
      get: t.procedure.query(() => currentLocale),
      set: t.procedure.input(z.enum(LOCALE_VALUES)).mutation(({ input }) => {
        currentLocale = input
        // Rebuild entire menu so all labels appear in the new language.
        buildApplicationMenu()
      }),
      subscribe: t.procedure.subscription(() => emitterToSingleArgObservable(menuEventsEmitter, "locale")),
    }),
    loreStat: t.router({
      get: t.procedure.query(() => currentLoreStat),
      set: t.procedure.input(z.enum(DISPLAY_TEXT_STAT_MODE_VALUES)).mutation(({ input }) => {
        currentLoreStat = input
        for (const [mode, item] of Object.entries(loreStatMenuItems)) {
          item.checked = mode === input
        }
      }),
      subscribe: t.procedure.subscription(() => emitterToSingleArgObservable(menuEventsEmitter, "loreStat")),
    }),
    theme: t.router({
      get: t.procedure.query(() => currentTheme),
      set: t.procedure.input(z.enum(THEME_PREFERENCE_VALUES)).mutation(({ input }) => {
        currentTheme = input
        for (const [theme, item] of Object.entries(themeMenuItems)) {
          item.checked = theme === input
        }

        if (input === "auto") {
          nativeTheme.themeSource = "system"
        } else {
          nativeTheme.themeSource = THEME_TO_MODE[input]
        }
      }),
      subscribe: t.procedure.subscription(() => emitterToSingleArgObservable(menuEventsEmitter, "theme")),
    }),
    wordWrap: t.router({
      get: t.procedure.query(() => currentWordWrap),
      set: t.procedure.input(z.boolean()).mutation(({ input }) => {
        currentWordWrap = input
        if (wordWrapMenuItem) wordWrapMenuItem.checked = input
      }),
      subscribe: t.procedure.subscription(() => emitterToSingleArgObservable(menuEventsEmitter, "wordWrap")),
    }),
  })
}

app.whenReady().then(async () => {
  console.log("Electron app is ready")
  await checkNativeDeps()
  console.log("Native deps checked")
  buildApplicationMenu()
  console.log("Application menu built")

  if (isDev) {
    serverUrl = "http://localhost:3000"
    console.log("Development mode, serverUrl:", serverUrl)
    // Install React Developer Tools
    try {
      const installer = await import("electron-devtools-installer")
      const install = (installer.default as any)?.default || installer.default || installer
      const devtools = installer.REACT_DEVELOPER_TOOLS || (installer.default as any)?.REACT_DEVELOPER_TOOLS

      if (typeof install === "function") {
        await install(devtools, {
          loadExtensionOptions: { allowFileAccess: true },
        })
        console.log("React Developer Tools installed")
      } else {
        console.warn("Could not find install function in electron-devtools-installer", installer)
      }
    } catch (err) {
      console.warn("Failed to install React Developer Tools:", err)
    }
  } else {
    serverUrl = `file://${path.join(app.getAppPath(), "dist", "frontend", "index.html")}`
    console.log("Production mode, serverUrl:", serverUrl)
  }
  console.log("Creating window...")
  const window = createWindow()
  console.log("Window created")

  // Import tRPC IPC handlers instead of the old HTTP server
  console.log("Creating tRPC IPC handler")
  const require = createRequire(import.meta.url)
  const { createIPCHandler } = require("electron-trpc/main")
  createIPCHandler({ router: appRouter, windows: [window] })
  console.log("Проверка роутера:", Object.keys(appRouter))
  console.log("tRPC IPC handler created")
})

// Quit when all windows are closed, except on macOS where the app stays
// running in the Dock until the user quits explicitly.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

// Re-create a window on macOS when the Dock icon is clicked and no windows exist.
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && serverUrl) {
    createWindow()
  }
})
