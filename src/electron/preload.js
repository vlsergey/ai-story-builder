'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Register a callback for native-menu actions sent from the main process.
   * Returns an unsubscribe function that removes only this specific listener.
   * Call the returned function on component unmount to avoid memory leaks.
   */
  onMenuAction: (callback) => {
    const handler = (_event, action) => callback(action)
    ipcRenderer.on('menu-action', handler)
    return () => ipcRenderer.removeListener('menu-action', handler)
  },

  /** Sync a UI setting back to the main process so native menu items stay in sync. */
  sendMenuState: (key, value) => {
    ipcRenderer.send('set-menu-state', { key, value })
  },

  /** Show a native error dialog with a "Copy to Clipboard" button. */
  showErrorDialog: (title, message) => {
    return ipcRenderer.invoke('show-error-dialog', { title, message })
  },

  /** Generic typed IPC invocation */
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),

  /** Start a streaming generation job */
  startStream: (streamId, endpoint, params) =>
    ipcRenderer.invoke('stream:start', { streamId, endpoint, params }),

  /** Abort an in-progress stream */
  abortStream: (streamId) =>
    ipcRenderer.invoke('stream:abort', { streamId }),

  /** Subscribe to stream events. Returns an unsubscribe function. */
  onStreamEvent: (callback) => {
    const handler = (_, data) => callback(data)
    ipcRenderer.on('stream:event', handler)
    return () => ipcRenderer.removeListener('stream:event', handler)
  },

  /**
   * Show a native alert dialog (synchronous).
   * @param {string} text
   */
  alert: (text) => {
    return ipcRenderer.sendSync('alert', text)
  },

  /**
   * Show a native confirmation dialog (synchronous).
   * @param {string} text
   * @returns {boolean}
   */
  confirm: (text) => {
    return ipcRenderer.sendSync('confirm', text)
  },
})
