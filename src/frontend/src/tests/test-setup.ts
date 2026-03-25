import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Mock ResizeObserver for dockview
class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

window.ResizeObserver = ResizeObserver;

// Mock electronAPI
window.electronAPI = {
  onMenuAction: vi.fn().mockReturnValue(() => {}),
  sendMenuState: vi.fn(),
  showErrorDialog: vi.fn().mockResolvedValue(undefined),
  invoke: vi.fn().mockResolvedValue({}),
  startStream: vi.fn().mockResolvedValue({ ok: true }),
  abortStream: vi.fn().mockResolvedValue({ ok: true }),
  onStreamEvent: vi.fn().mockReturnValue(() => {}),
  alert: vi.fn(),
  confirm: vi.fn().mockReturnValue(true),
};

// Mock electronTRPC for ipcLink
(window as any).electronTRPC = {
  sendMessage: vi.fn(),
  onMessage: vi.fn(),
};

// Clean up after each test
afterEach(() => {
  cleanup();
});
