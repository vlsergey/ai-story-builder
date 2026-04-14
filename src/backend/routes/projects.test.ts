/**
 * Integration tests for project route pure functions
 * (routes that do not require an open database)
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

// Mutable app settings store shared across the module mock
const mockSettings: { recent: string[]; lastOpenedPath?: string } = { recent: [] }

vi.mock("../db/state.js", () => ({
  getCurrentDbPath: () => null,
  setCurrentDbPath: vi.fn(),
  readAppSettings: () => mockSettings,
  writeAppSettings: (s: typeof mockSettings) => {
    mockSettings.recent = s.recent ?? []
    mockSettings.lastOpenedPath = s.lastOpenedPath
  },
  getDataDir: () => "/tmp/test-data",
}))

vi.mock("../lib/ai-logging.js", () => ({ setVerboseLogging: vi.fn() }))

const { deleteRecentProject } = await import("./projects.js")

beforeEach(() => {
  mockSettings.recent = []
  delete mockSettings.lastOpenedPath
})

// ── deleteRecentProject ────────────────────────────────────────────────────────

describe("deleteRecentProject", () => {
  it("removes the specified path from the recent list", () => {
    mockSettings.recent = ["/data/a.sqlite", "/data/b.sqlite", "/data/c.sqlite"]

    const res = deleteRecentProject("/data/b.sqlite")

    expect(res.ok).toBe(true)
    expect(mockSettings.recent).toEqual(["/data/a.sqlite", "/data/c.sqlite"])
  })

  it("is a no-op when path is not in the recent list", () => {
    mockSettings.recent = ["/data/a.sqlite"]

    const res = deleteRecentProject("/data/nonexistent.sqlite")

    expect(res.ok).toBe(true)
    expect(mockSettings.recent).toEqual(["/data/a.sqlite"])
  })

  it("throws 400 when path is empty", () => {
    expect(() => deleteRecentProject("")).toThrow()
    try {
      deleteRecentProject("")
    } catch (e: any) {
      expect(e.status).toBe(400)
    }
  })
})
