/**
 * Types for the Electron IPC bridge exposed via contextBridge in preload.js.
 * window.electronAPI is only present when the app runs inside Electron.
 */
export {};

declare global {
  interface Window {
    electronAPI: {
      /** Register a handler for native-menu actions */
      onMenuAction: (callback: (action: string) => void) => () => void;
      /** Sync a UI setting back to the main process */
      sendMenuState: (key: string, value: boolean | string) => void;
      /** Show a native error dialog with a "Copy to Clipboard" button. */
      showErrorDialog: (title: string, message: string) => Promise<void>;
      /** Invoke a tRPC procedure via IPC */
      invoke: (path: string, ...args: unknown[]) => Promise<unknown>;
      /** Start a streaming generation job */
      startStream: (streamId: string, endpoint: string, params: unknown) => Promise<{ ok: boolean }>;
      /** Abort an in‑progress stream */
      abortStream: (streamId: string) => Promise<{ ok: boolean }>;
      /** Subscribe to stream events. Returns an unsubscribe function. */
      onStreamEvent: (callback: (data: StreamEvent) => void) => () => void;
      /** Show a native alert dialog (synchronous). */
      alert: (text: string) => void;
      /** Show a native confirmation dialog (synchronous). */
      confirm: (text: string) => boolean;
    };
  }
}

interface StreamEvent {
  streamId: string;
  type: 'thinking' | 'partial_json' | 'done' | 'error';
  data: Record<string, unknown>;
}
