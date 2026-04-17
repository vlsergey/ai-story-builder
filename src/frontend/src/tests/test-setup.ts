import { afterEach, vi } from "vitest"
import { cleanup } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"

// Mock ResizeObserver for dockview
class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

window.ResizeObserver = ResizeObserver

// Mock electronTRPC for ipcLink
;(window as any).electronTRPC = {
  sendMessage: vi.fn(),
  onMessage: vi.fn(),
}

// Clean up after each test
afterEach(() => {
  cleanup()
})
