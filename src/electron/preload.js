'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Register a callback for native-menu actions sent from the main process.
   * Multiple calls accumulate listeners — call removeMenuActionListeners() first
   * if you need to replace the handler.
   */
  onMenuAction: (callback) => {
    ipcRenderer.on('menu-action', (_event, action) => callback(action))
  },

  /** Remove all 'menu-action' IPC listeners (used on component unmount). */
  removeMenuActionListeners: () => {
    ipcRenderer.removeAllListeners('menu-action')
  },

  /** Sync a UI setting back to the main process so native menu items stay in sync. */
  sendMenuState: (key, value) => {
    ipcRenderer.send('set-menu-state', { key, value })
  },
})
