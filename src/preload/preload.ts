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
