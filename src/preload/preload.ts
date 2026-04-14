import { contextBridge, ipcRenderer } from "electron"
import { ELECTRON_TRPC_CHANNEL } from "electron-trpc/renderer"

console.log("Exposing tRPC Bridge...")
contextBridge.exposeInMainWorld("electronTRPC", {
  rpc: (op: any) => ipcRenderer.invoke(ELECTRON_TRPC_CHANNEL, op),
  sendMessage: (op: any) => ipcRenderer.send(ELECTRON_TRPC_CHANNEL, op),
  // 3. Для получения ответов и обновлений (Subscriptions)
  onMessage: (callback: (op: any) => void) => {
    const subscription = (_event: any, op: any) => callback(op)
    ipcRenderer.on(ELECTRON_TRPC_CHANNEL, subscription)
    return () => ipcRenderer.removeListener(ELECTRON_TRPC_CHANNEL, subscription)
  },
})
console.log("Exposing tRPC Bridge... Done")

contextBridge.exposeInMainWorld("electronAPI", {
  /**
   * Register a callback for native-menu actions sent from the main process.
   * Returns an unsubscribe function that removes only this specific listener.
   * Call the returned function on component unmount to avoid memory leaks.
   */
  onMenuAction: (callback: (action: string) => void) => {
    const handler = (_event: any, action: any) => callback(action)
    ipcRenderer.on("menu-action", handler)
    return () => ipcRenderer.removeListener("menu-action", handler)
  },

  /** Sync a UI setting back to the main process so native menu items stay in sync. */
  sendMenuState: (key: any, value: any) => {
    ipcRenderer.send("set-menu-state", { key, value })
  },

  /** Show a native error dialog with a "Copy to Clipboard" button. */
  showErrorDialog: (title: any, message: any) => {
    return ipcRenderer.invoke("show-error-dialog", { title, message })
  },

  /** Start a streaming generation job */
  startStream: (streamId: any, endpoint: any, params: any) =>
    ipcRenderer.invoke("stream:start", { streamId, endpoint, params }),

  /** Abort an in-progress stream */
  abortStream: (streamId: any) => ipcRenderer.invoke("stream:abort", { streamId }),

  /** Subscribe to stream events. Returns an unsubscribe function. */
  onStreamEvent: (callback: (data: any) => any) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on("stream:event", handler)
    return () => ipcRenderer.removeListener("stream:event", handler)
  },

  /**
   * Show a native alert dialog (synchronous).
   * @param {string} text
   */
  alert: (text: any) => {
    return ipcRenderer.sendSync("alert", text)
  },

  /**
   * Show a native confirmation dialog (synchronous).
   * @param {string} text
   * @returns {boolean}
   */
  confirm: (text: any) => {
    return ipcRenderer.sendSync("confirm", text)
  },
})
