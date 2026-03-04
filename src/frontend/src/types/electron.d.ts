/**
 * Types for the Electron IPC bridge exposed via contextBridge in preload.js.
 * window.electronAPI is only present when the app runs inside Electron.
 */
export {}

declare global {
  interface Window {
    electronAPI?: {
      /** Register a handler for native-menu actions (e.g. 'reset-layouts', 'close-project', 'set-theme:obsidian'). */
      onMenuAction: (callback: (action: string) => void) => void
      /** Remove all registered menu-action listeners (call on component unmount). */
      removeMenuActionListeners: () => void
      /** Sync a UI setting back to the main process (e.g. 'word-wrap', true). */
      sendMenuState: (key: string, value: boolean | string) => void
      /** Show a native error dialog with a "Copy to Clipboard" button. */
      showErrorDialog: (title: string, message: string) => Promise<void>
    }
  }
}
