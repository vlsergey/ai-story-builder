/**
 * Integration tests for syncLore()
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AllAiEnginesConfig } from "../../shared/ai-engine-config.js"
import { setUpTestDb, tearDownTestDb } from "../db/test-db-utils.js"
import { LoreNodeRepository } from "../lore/lore-node-repository.js"
import { SettingsRepository } from "../settings/settings-repository.js"

// ─── OpenAI mock ──────────────────────────────────────────────────────────────

const { mockFilesCreate, mockFilesDel, mockFilesRetrieve, mockVsCreate, mockVsDel, mockVsRetrieve, mockToFile } =
  vi.hoisted(() => ({
    mockFilesCreate: vi.fn(),
    mockFilesDel: vi.fn(),
    mockFilesRetrieve: vi.fn(),
    mockVsCreate: vi.fn(),
    mockVsDel: vi.fn(),
    mockVsRetrieve: vi.fn(),
    mockToFile: vi.fn(async () => ({})),
  }))

vi.mock("openai", () => ({
  default: class {
    files = { create: mockFilesCreate, delete: mockFilesDel, retrieve: mockFilesRetrieve }
    vectorStores = { create: mockVsCreate, delete: mockVsDel, retrieve: mockVsRetrieve }
  },
  toFile: mockToFile,
}))

// ─── Import pure function ─────────────────────────────────────────────────────

const { syncLore, POLL_CONFIG } = await import("./ai-sync.js")

// ─── DB helper ────────────────────────────────────────────────────────────────

function setupDb(opts?: {
  apiKey?: string
  folderId?: string
  searchIndexId?: string
  currentEngine?: string
  grokApiKey?: string
  nodes?: Array<{
    id?: number
    parent_id?: number | null
    title: string
    content?: string | null
    word_count?: number
    to_be_deleted?: number
    ai_sync_info?: string | null
  }>
}) {
  const currentEngine =
    opts?.currentEngine ?? (opts?.grokApiKey ? "grok" : opts?.apiKey || opts?.folderId ? "yandex" : undefined)
  if (currentEngine) {
    SettingsRepository.setCurrentBackend(currentEngine)
  }

  const aiConfig: AllAiEnginesConfig = {}
  if (opts?.apiKey || opts?.folderId) {
    const yandex: Record<string, string> = {}
    if (opts.apiKey) yandex.api_key = opts.apiKey
    if (opts.folderId) yandex.folder_id = opts.folderId
    if (opts.searchIndexId) yandex.search_index_id = opts.searchIndexId
    aiConfig.yandex = yandex
  }
  if (opts?.grokApiKey) {
    aiConfig.grok = { api_key: opts.grokApiKey }
  }
  if (Object.keys(aiConfig).length > 0) {
    SettingsRepository.saveAllAiEnginesConfig(aiConfig)
  }

  const repo = new LoreNodeRepository()
  let autoId = 1
  for (const n of opts?.nodes ?? []) {
    repo.insert({
      id: n.id ?? autoId++,
      parent_id: n.parent_id ?? null,
      title: n.title,
      content: n.content ?? null,
      word_count: n.word_count ?? 0,
      to_be_deleted: n.to_be_deleted ?? 0,
      ai_sync_info: n.ai_sync_info ?? null,
    })
  }
}

beforeEach(() => {
  setUpTestDb()
  vi.resetAllMocks()
  mockToFile.mockResolvedValue({}) // restore default after reset
})
afterEach(() => {
  vi.useRealTimers()
  tearDownTestDb()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("syncLore", () => {
  // ─── 1. Basic validation ─────────────────────────────────────────────────────

  it("throws 400 when no project open", async () => {
    tearDownTestDb()
    await expect(syncLore()).rejects.toThrow(/no project open/)
    try {
      await syncLore()
    } catch (e: any) {
      expect(e.status).toBe(400)
    }
  })

  it("throws 400 when no AI engine is configured", async () => {
    setupDb()
    await expect(syncLore()).rejects.toThrow(/no AI engine configured/)
    try {
      await syncLore()
    } catch (e: any) {
      expect(e.status).toBe(400)
    }
  })

  it("throws 400 when current engine is unknown / not supported", async () => {
    setupDb({ currentEngine: "unknown-engine" })
    await expect(syncLore()).rejects.toThrow(/not supported for engine 'unknown-engine'/)
    try {
      await syncLore()
    } catch (e: any) {
      expect(e.status).toBe(400)
    }
  })

  it("throws 400 when api_key is missing", async () => {
    setupDb({ folderId: "b1g123" })
    await expect(syncLore()).rejects.toThrow(/api_key/)
    try {
      await syncLore()
    } catch (e: any) {
      expect(e.status).toBe(400)
    }
  })

  it("throws 400 when folder_id is missing", async () => {
    setupDb({ apiKey: "AQVN-test" })
    await expect(syncLore()).rejects.toThrow(/folder_id/)
    try {
      await syncLore()
    } catch (e: any) {
      expect(e.status).toBe(400)
    }
  })

  // ─── 3. All nodes already synced and up-to-date ──────────────────────────────

  it("returns unchanged count when all nodes are already synced", async () => {
    const syncedAt = "2025-01-01T12:00:00.000Z"
    setupDb({
      apiKey: "AQVN-key",
      folderId: "b1g123",
      nodes: [
        {
          title: "Chapter 1",
          content: "Some content here",
          word_count: 3,
          to_be_deleted: 0,
          ai_sync_info: JSON.stringify({
            yandex: { last_synced_at: syncedAt, file_id: "f1", content_updated_at: syncedAt },
          }),
        },
        {
          title: "Chapter 2",
          content: "More content here",
          word_count: 3,
          to_be_deleted: 0,
          ai_sync_info: JSON.stringify({
            yandex: { last_synced_at: syncedAt, file_id: "f2", content_updated_at: "2024-12-31T00:00:00.000Z" },
          }),
        },
      ],
    })

    // Two unchanged nodes with file_ids в†’ vector store will be created
    mockVsCreate.mockResolvedValueOnce({ id: "vs-new", status: "completed" })

    const result = await syncLore()
    expect(result.ok).toBe(true)
    expect(result.uploaded).toBe(0)
    expect(result.deleted).toBe(0)
    expect(result.unchanged).toBe(2)
    expect(mockFilesCreate).not.toHaveBeenCalled()
  })

  // ─── 4. Uploads new non-empty node ───────────────────────────────────────────

  it("uploads a new non-empty node and stores file_id in ai_sync_info", async () => {
    setupDb({
      apiKey: "AQVN-key",
      folderId: "b1g123",
      nodes: [
        {
          id: 42,
          title: "Dragon Lore",
          content: "Dragons are ancient creatures",
          word_count: 4,
          to_be_deleted: 0,
          ai_sync_info: null,
        },
      ],
    })

    mockFilesCreate.mockResolvedValueOnce({ id: "remote-file-1" })
    mockVsCreate.mockResolvedValueOnce({ id: "idx-1", status: "completed" })

    const result = await syncLore()
    expect(result.ok).toBe(true)
    expect(result.uploaded).toBe(1)
    expect(result.deleted).toBe(0)
    expect(result.search_index_id).toBe("idx-1")

    // Verify DB was updated
    const repo = new LoreNodeRepository()
    const node = repo.getById(42)
    expect(node).toBeDefined()
    const syncInfo = JSON.parse(node!.ai_sync_info!) as { yandex: { file_id: string } }
    expect(syncInfo.yandex.file_id).toBe("remote-file-1")

    // Verify toFile was called with .md filename and correct content
    expect(mockToFile).toHaveBeenCalledOnce()
    const [toFileBuffer, toFileName, toFileOpts] = mockToFile.mock.calls[0] as unknown as [
      Buffer,
      string,
      { type: string },
    ]
    expect(toFileName).toBe("lore-42.md")
    expect(toFileOpts.type).toBe("text/plain")
    // Verify YAML frontmatter in file content
    const content = toFileBuffer.toString("utf-8")
    expect(content).toContain("---")
    expect(content).toContain("path: /Dragon Lore")
    expect(content).toContain("Dragons are ancient creatures")
    // Verify files.create was called with purpose: 'assistants'
    expect(mockFilesCreate).toHaveBeenCalledOnce()
    expect(mockFilesCreate.mock.calls[0][0].purpose).toBe("assistants")
  })

  // ─── 5. Skips unchanged node ─────────────────────────────────────────────────

  it("skips node where content_updated_at <= last_synced_at", async () => {
    const syncedAt = "2025-06-01T00:00:00.000Z"
    setupDb({
      apiKey: "AQVN-key",
      folderId: "b1g123",
      nodes: [
        {
          id: 10,
          title: "World History",
          content: "Long history text",
          word_count: 3,
          to_be_deleted: 0,
          ai_sync_info: JSON.stringify({
            yandex: { last_synced_at: syncedAt, file_id: "f-existing", content_updated_at: "2025-05-31T00:00:00.000Z" },
          }),
        },
      ],
    })

    mockVsCreate.mockResolvedValueOnce({ id: "idx-new", status: "completed" })

    const result = await syncLore()
    expect(result.uploaded).toBe(0)
    expect(result.unchanged).toBe(1)
    expect(mockFilesCreate).not.toHaveBeenCalled()
  })

  // ─── 6. Re-uploads changed node ──────────────────────────────────────────────

  it("re-uploads node when content_updated_at > last_synced_at", async () => {
    setupDb({
      apiKey: "AQVN-key",
      folderId: "b1g123",
      nodes: [
        {
          id: 20,
          title: "Magic System",
          content: "Updated magic rules",
          word_count: 3,
          to_be_deleted: 0,
          ai_sync_info: JSON.stringify({
            yandex: {
              last_synced_at: "2025-01-01T00:00:00.000Z",
              file_id: "old-file",
              content_updated_at: "2025-06-01T00:00:00.000Z",
            },
          }),
        },
      ],
    })

    mockFilesCreate.mockResolvedValueOnce({ id: "new-file-id" })
    mockVsCreate.mockResolvedValueOnce({ id: "idx-1", status: "completed" })

    const result = await syncLore()
    expect(result.uploaded).toBe(1)

    // Verify new file_id stored
    const repo = new LoreNodeRepository()
    const node = repo.getById(20)
    expect(node).toBeDefined()
    const syncInfo = JSON.parse(node!.ai_sync_info!) as { yandex: { file_id: string } }
    expect(syncInfo.yandex.file_id).toBe("new-file-id")
  })

  // ─── 7. Deletes remote file for to_be_deleted=1 node ─────────────────────────

  it("deletes remote file for to_be_deleted=1 node and physically removes row from DB", async () => {
    setupDb({
      apiKey: "AQVN-key",
      folderId: "b1g123",
      nodes: [
        {
          id: 30,
          title: "Deleted Chapter",
          content: "Old content",
          word_count: 2,
          to_be_deleted: 1,
          ai_sync_info: JSON.stringify({
            yandex: {
              last_synced_at: "2025-01-01T00:00:00.000Z",
              file_id: "del-file",
              content_updated_at: "2025-01-01T00:00:00.000Z",
            },
          }),
        },
      ],
    })

    mockFilesDel.mockResolvedValueOnce({ deleted: true })

    const result = await syncLore()
    expect(result.deleted).toBe(1)
    expect(result.uploaded).toBe(0)
    expect(result.search_index_id).toBeNull()

    // Verify delete was called with the right file ID
    expect(mockFilesDel).toHaveBeenCalledWith("del-file")

    // Row must be physically removed from DB after sync
    const repo = new LoreNodeRepository()
    const node = repo.getById(30)
    expect(node).toBeUndefined()
  })

  it("Yandex: physically removes to_be_deleted=1 node that was never synced (no file_id)", async () => {
    setupDb({
      apiKey: "AQVN-key",
      folderId: "b1g123",
      nodes: [
        {
          id: 31,
          title: "Never Synced Node",
          content: "",
          word_count: 0,
          to_be_deleted: 1,
          ai_sync_info: null,
        },
      ],
    })

    const result = await syncLore()
    // No remote file to delete
    expect(mockFilesDel).not.toHaveBeenCalled()

    // Row must be physically removed from DB
    const repo = new LoreNodeRepository()
    const node = repo.getById(31)
    expect(node).toBeUndefined()
    void result
  })

  // ─── 8. Deletes remote file for emptied node (word_count=0) ──────────────────

  it("deletes remote file for emptied node and clears file_id in ai_sync_info", async () => {
    setupDb({
      apiKey: "AQVN-key",
      folderId: "b1g123",
      nodes: [
        {
          id: 40,
          title: "Empty Node",
          content: "",
          word_count: 0,
          to_be_deleted: 0,
          ai_sync_info: JSON.stringify({
            yandex: {
              last_synced_at: "2025-01-01T00:00:00.000Z",
              file_id: "empty-file",
              content_updated_at: "2025-01-01T00:00:00.000Z",
            },
          }),
        },
      ],
    })

    mockFilesDel.mockResolvedValueOnce({ deleted: true })

    const result = await syncLore()
    expect(result.deleted).toBe(1)

    // Verify ai_sync_info.yandex has no file_id (but record still exists)
    const repo = new LoreNodeRepository()
    const node = repo.getById(40)
    expect(node).toBeDefined()
    const syncInfo = JSON.parse(node!.ai_sync_info!) as { yandex: { last_synced_at: string; file_id?: string } }
    expect(syncInfo.yandex).toBeDefined()
    expect(syncInfo.yandex.last_synced_at).toBeDefined()
    expect(syncInfo.yandex.file_id).toBeUndefined()
  })

  // ─── 9. Deletes old VectorStore, creates new, polls until done ───────────────

  it("deletes old VectorStore, creates new one, polls until done, stores search_index_id", async () => {
    setupDb({
      apiKey: "AQVN-key",
      folderId: "b1g123",
      searchIndexId: "old-idx",
      nodes: [
        {
          id: 50,
          title: "World Building",
          content: "The world is vast",
          word_count: 4,
          to_be_deleted: 0,
          ai_sync_info: JSON.stringify({
            yandex: {
              last_synced_at: "2025-06-01T00:00:00.000Z",
              file_id: "f-existing",
              content_updated_at: "2025-05-01T00:00:00.000Z",
            },
          }),
        },
      ],
    })

    mockVsDel.mockResolvedValueOnce({ deleted: true })
    mockVsCreate.mockResolvedValueOnce({ id: "new-idx-456", status: "in_progress" })
    mockVsRetrieve.mockResolvedValueOnce({ id: "new-idx-456", status: "completed" })

    const result = await syncLore()
    expect(result.ok).toBe(true)
    expect(result.search_index_id).toBe("new-idx-456")

    // Verify delete was called on old index
    expect(mockVsDel).toHaveBeenCalledWith("old-idx")
    // Verify polling was triggered
    expect(mockVsRetrieve).toHaveBeenCalledWith("new-idx-456")

    // Verify search_index_id stored in settings
    const config = SettingsRepository.getAllAiEnginesConfig()
    expect(config.yandex?.search_index_id).toBe("new-idx-456")
  })

  // ─── 10. Empty allFileIds: delete old index, don't create new one ────────────

  it("when all files deleted, removes old VectorStore and clears search_index_id", async () => {
    setupDb({
      apiKey: "AQVN-key",
      folderId: "b1g123",
      searchIndexId: "old-idx",
      nodes: [
        {
          id: 60,
          title: "Removed Chapter",
          content: "Content",
          word_count: 1,
          to_be_deleted: 1,
          ai_sync_info: JSON.stringify({
            yandex: {
              last_synced_at: "2025-01-01T00:00:00.000Z",
              file_id: "f-to-delete",
              content_updated_at: "2025-01-01T00:00:00.000Z",
            },
          }),
        },
      ],
    })

    mockFilesDel.mockResolvedValueOnce({ deleted: true })
    mockVsDel.mockResolvedValueOnce({ deleted: true })

    const result = await syncLore()
    expect(result.ok).toBe(true)
    expect(result.search_index_id).toBeNull()

    // VectorStore create should NOT have been called
    expect(mockVsCreate).not.toHaveBeenCalled()

    // Verify search_index_id cleared in settings
    const config = SettingsRepository.getAllAiEnginesConfig()
    expect(config.yandex?.search_index_id).toBeUndefined()
  })

  // ─── 11. Files uploaded first, then vector store created (Yandex) ────────────

  it("uploads all files first, then creates the vector store with those file IDs (Yandex)", async () => {
    setupDb({
      apiKey: "AQVN-key",
      folderId: "b1g123",
      nodes: [
        { id: 1, title: "Characters", content: "Hero is brave", word_count: 3, to_be_deleted: 0, ai_sync_info: null },
        { id: 2, title: "Locations", content: "Dark forest", word_count: 2, to_be_deleted: 0, ai_sync_info: null },
      ],
    })

    const callOrder: string[] = []
    const uploadedFileIds: string[] = []

    mockFilesCreate
      .mockImplementationOnce(async () => {
        callOrder.push("files.create:1")
        uploadedFileIds.push("fid-1")
        return { id: "fid-1" }
      })
      .mockImplementationOnce(async () => {
        callOrder.push("files.create:2")
        uploadedFileIds.push("fid-2")
        return { id: "fid-2" }
      })
    mockVsCreate.mockImplementationOnce(async (params: { file_ids?: string[] }) => {
      callOrder.push("vectorStores.create")
      expect(params.file_ids).toEqual(expect.arrayContaining(["fid-1", "fid-2"]))
      return { id: "vs-result", status: "completed" }
    })

    const result = await syncLore()
    expect(result.uploaded).toBe(2)
    expect(result.search_index_id).toBe("vs-result")

    // Both file uploads must precede the vector store creation
    expect(callOrder).toEqual(["files.create:1", "files.create:2", "vectorStores.create"])

    // Vector store received both file IDs
    expect(mockVsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ file_ids: expect.arrayContaining(["fid-1", "fid-2"]) }),
    )
  })

  // ─── 12. Grok: returns 400 when api_key is missing ───────────────────────────

  it("throws 400 for Grok when api_key is missing", async () => {
    setupDb({ currentEngine: "grok" })
    await expect(syncLore()).rejects.toThrow(/api_key/)
    try {
      await syncLore()
    } catch (e: any) {
      expect(e.status).toBe(400)
    }
  })

  // ─── 13. throws when file upload fails ───────────────────────────────────────

  it("throws when file upload fails", async () => {
    setupDb({
      apiKey: "AQVN-key",
      folderId: "b1g123",
      nodes: [
        {
          id: 70,
          title: "New Node",
          content: "Some content",
          word_count: 2,
          to_be_deleted: 0,
          ai_sync_info: null,
        },
      ],
    })

    mockFilesCreate.mockRejectedValueOnce(Object.assign(new Error("HTTP 500 Internal Server Error"), { status: 500 }))

    await expect(syncLore()).rejects.toThrow(/Upload failed/)
  })

  // ─── 14. throws when VectorStore polling times out ───────────────────────────

  it("throws when VectorStore polling exceeds timeout", async () => {
    setupDb({
      apiKey: "AQVN-key",
      folderId: "b1g123",
      nodes: [
        {
          id: 80,
          title: "Long Node",
          content: "Some content",
          word_count: 2,
          to_be_deleted: 0,
          ai_sync_info: null,
        },
      ],
    })

    const origIntervalMs = POLL_CONFIG.intervalMs
    const origTimeoutMs = POLL_CONFIG.timeoutMs
    POLL_CONFIG.intervalMs = 5
    POLL_CONFIG.timeoutMs = 20

    mockFilesCreate.mockResolvedValueOnce({ id: "file-1" })
    mockVsCreate.mockResolvedValueOnce({ id: "vs-timeout", status: "in_progress" })
    // Always return in_progress в†’ triggers timeout
    mockVsRetrieve.mockResolvedValue({ id: "vs-timeout", status: "in_progress" })

    try {
      await expect(syncLore()).rejects.toThrow(/timed out/)
    } finally {
      POLL_CONFIG.intervalMs = origIntervalMs
      POLL_CONFIG.timeoutMs = origTimeoutMs
    }
  })

  // ─── Grok sync (collapsed tree) ──────────────────────────────────────────────

  it("Grok: physically removes to_be_deleted=1 nodes after sync", async () => {
    setupDb({
      grokApiKey: "xai-key",
      nodes: [
        { id: 1, parent_id: null, title: "Root", content: null, word_count: 0 },
        {
          id: 2,
          parent_id: 1,
          title: "Deleted Category",
          content: "some text",
          word_count: 2,
          to_be_deleted: 1,
          ai_sync_info: JSON.stringify({
            grok: {
              file_id: "grok-del-file",
              last_synced_at: "2025-01-01T00:00:00.000Z",
              content_updated_at: "2025-01-01T00:00:00.000Z",
            },
          }),
        },
        {
          id: 3,
          parent_id: 1,
          title: "Never Synced Deleted",
          content: "",
          word_count: 0,
          to_be_deleted: 1,
          ai_sync_info: null,
        },
      ],
    })

    await syncLore()

    const repo = new LoreNodeRepository()
    const deletedNodes = repo.findAll().filter((n) => n.to_be_deleted === 1)
    expect(deletedNodes).toHaveLength(0)
  })

  it("Grok: uploads collapsed group for new nodes", async () => {
    // Tree: root(id=1) в†’ category(id=2) в†’ item(id=3)
    setupDb({
      grokApiKey: "xai-key",
      nodes: [
        { id: 1, parent_id: null, title: "Root", content: null, word_count: 0 },
        { id: 2, parent_id: 1, title: "Characters", content: "General info", word_count: 2 },
        { id: 3, parent_id: 2, title: "Hero", content: "A brave hero", word_count: 3 },
      ],
    })

    mockFilesCreate.mockResolvedValueOnce({ id: "grok-file-1" })

    const result = await syncLore()
    expect(result.ok).toBe(true)
    expect(result.uploaded).toBe(1)
    expect(result.deleted).toBe(0)
    expect(result.unchanged).toBe(0)
    expect(result.search_index_id).toBeNull()

    // Level-2 node gets file_id; level-3 node gets merged_into_parent
    const repo = new LoreNodeRepository()
    const node2 = repo.getById(2)
    const node3 = repo.getById(3)
    expect(node2).toBeDefined()
    expect(node3).toBeDefined()
    const sync2 = JSON.parse(node2!.ai_sync_info!) as { grok: { file_id: string; merged_into_parent?: boolean } }
    const sync3 = JSON.parse(node3!.ai_sync_info!) as { grok: { file_id?: string; merged_into_parent?: boolean } }
    expect(sync2.grok.file_id).toBe("grok-file-1")
    expect(sync2.grok.merged_into_parent).toBeUndefined()
    expect(sync3.grok.merged_into_parent).toBe(true)
    expect(sync3.grok.file_id).toBeUndefined()
  })

  it("Grok: does not re-upload unchanged group", async () => {
    const syncedAt = "2025-01-01T12:00:00.000Z"
    setupDb({
      grokApiKey: "xai-key",
      nodes: [
        { id: 1, parent_id: null, title: "Root", content: null, word_count: 0 },
        {
          id: 2,
          parent_id: 1,
          title: "Characters",
          content: "Info",
          word_count: 1,
          ai_sync_info: JSON.stringify({
            grok: { file_id: "grok-f1", last_synced_at: syncedAt, content_updated_at: syncedAt },
          }),
        },
        {
          id: 3,
          parent_id: 2,
          title: "Hero",
          content: "Hero text",
          word_count: 2,
          ai_sync_info: JSON.stringify({
            grok: { merged_into_parent: true, last_synced_at: syncedAt, content_updated_at: syncedAt },
          }),
        },
      ],
    })

    const result = await syncLore()
    expect(result.uploaded).toBe(0)
    expect(result.unchanged).toBe(1)
    expect(mockFilesCreate).not.toHaveBeenCalled()
  })

  it("Grok: re-uploads group when node content changed", async () => {
    const syncedAt = "2025-01-01T12:00:00.000Z"
    const updatedAt = "2025-06-01T00:00:00.000Z"
    setupDb({
      grokApiKey: "xai-key",
      nodes: [
        { id: 1, parent_id: null, title: "Root", content: null, word_count: 0 },
        {
          id: 2,
          parent_id: 1,
          title: "Characters",
          content: "Info",
          word_count: 1,
          ai_sync_info: JSON.stringify({
            grok: { file_id: "old-file", last_synced_at: syncedAt, content_updated_at: syncedAt },
          }),
        },
        {
          id: 3,
          parent_id: 2,
          title: "Hero",
          content: "Updated hero text",
          word_count: 3,
          ai_sync_info: JSON.stringify({
            grok: { merged_into_parent: true, last_synced_at: syncedAt, content_updated_at: updatedAt },
          }),
        },
      ],
    })

    mockFilesCreate.mockResolvedValueOnce({ id: "new-grok-file" })

    const result = await syncLore()
    expect(result.uploaded).toBe(1)

    // Grok does not support file deletion — old file is left as-is
    expect(mockFilesDel).not.toHaveBeenCalled()

    // Verify new file_id stored on level-2 node
    const repo = new LoreNodeRepository()
    const node = repo.getById(2)
    expect(node).toBeDefined()
    const syncInfo = JSON.parse(node!.ai_sync_info!) as { grok: { file_id: string } }
    expect(syncInfo.grok.file_id).toBe("new-grok-file")
  })

  it("Grok: re-uploads group when a new child node is added (no grok sync entry)", async () => {
    const syncedAt = "2025-01-01T12:00:00.000Z"
    setupDb({
      grokApiKey: "xai-key",
      nodes: [
        { id: 1, parent_id: null, title: "Root", content: null, word_count: 0 },
        {
          id: 2,
          parent_id: 1,
          title: "Characters",
          content: "Info",
          word_count: 1,
          ai_sync_info: JSON.stringify({
            grok: { file_id: "existing-file", last_synced_at: syncedAt, content_updated_at: syncedAt },
          }),
        },
        // New child added after the last sync — no grok entry
        { id: 3, parent_id: 2, title: "Villain", content: "Newly added villain", word_count: 3, ai_sync_info: null },
      ],
    })

    mockFilesCreate.mockResolvedValueOnce({ id: "updated-grok-file" })

    const result = await syncLore()
    expect(result.uploaded).toBe(1)
    expect(mockFilesCreate).toHaveBeenCalledOnce()
    expect(mockFilesDel).not.toHaveBeenCalled()
  })

  it("Grok: marks group as deleted locally but does NOT call files.delete (no fileDeletion capability)", async () => {
    const syncedAt = "2025-01-01T12:00:00.000Z"
    setupDb({
      grokApiKey: "xai-key",
      nodes: [
        { id: 1, parent_id: null, title: "Root", content: null, word_count: 0 },
        {
          id: 2,
          parent_id: 1,
          title: "EmptyCategory",
          content: "",
          word_count: 0,
          ai_sync_info: JSON.stringify({ grok: { file_id: "old-empty-file", last_synced_at: syncedAt } }),
        },
      ],
    })

    const result = await syncLore()
    expect(result.deleted).toBe(1)
    expect(result.uploaded).toBe(0)
    expect(mockFilesDel).not.toHaveBeenCalled()
    expect(mockFilesCreate).not.toHaveBeenCalled()
  })

  it("Grok: throws 400 when too many top-level categories", async () => {
    // 11 level-2 nodes (> maxFilesPerRequest=10)
    const nodes: Array<{
      id: number
      parent_id: number | null
      title: string
      content: string | null
      word_count: number
    }> = [{ id: 1, parent_id: null, title: "Root", content: null, word_count: 0 }]
    for (let i = 2; i <= 12; i++) {
      nodes.push({ id: i, parent_id: 1, title: `Cat${i}`, content: `Content ${i}`, word_count: 2 })
    }
    setupDb({ grokApiKey: "xai-key", nodes })

    await expect(syncLore()).rejects.toThrow(/Too many top-level lore categories/)
    try {
      await syncLore()
    } catch (e: any) {
      expect(e.status).toBe(400)
    }
    expect(mockFilesCreate).not.toHaveBeenCalled()
  })

  it("Grok: uploads correct collapsed content with markdown headings", async () => {
    setupDb({
      grokApiKey: "xai-key",
      nodes: [
        { id: 1, parent_id: null, title: "Root", content: null, word_count: 0 },
        { id: 2, parent_id: 1, title: "World", content: "World overview", word_count: 2 },
        { id: 3, parent_id: 2, title: "Continent", content: "Continent details", word_count: 2 },
        { id: 4, parent_id: 3, title: "City", content: "City info", word_count: 2 },
      ],
    })

    mockFilesCreate.mockResolvedValueOnce({ id: "grok-deep" })

    await syncLore()

    expect(mockToFile).toHaveBeenCalledOnce()
    const [buf, filename] = mockToFile.mock.calls[0] as unknown as [Buffer, string, unknown]
    expect(filename).toBe("lore-group-2.md")
    const content = buf.toString("utf-8")
    expect(content).toContain("# World")
    expect(content).toContain("World overview")
    expect(content).toContain("## World / Continent")
    expect(content).toContain("Continent details")
    expect(content).toContain("### World / Continent / City")
    expect(content).toContain("City info")
  })

  // ─── 405 fallback: retrieve check (Yandex, which supports fileDeletion) ──────

  it("Yandex: treats 405 on delete as success when retrieve returns 404", async () => {
    setupDb({
      apiKey: "yandex-key",
      folderId: "folder-1",
      nodes: [
        {
          id: 1,
          parent_id: null,
          title: "EmptyNode",
          content: null,
          word_count: 0,
          ai_sync_info: JSON.stringify({
            yandex: { last_synced_at: "2024-01-01T00:00:00.000Z", file_id: "old-405-file" },
          }),
        },
      ],
    })

    // delete returns 405
    mockFilesDel.mockRejectedValueOnce(Object.assign(new Error("HTTP 405"), { status: 405 }))
    // retrieve returns 404 в†’ file is already gone
    mockFilesRetrieve.mockRejectedValueOnce(Object.assign(new Error("HTTP 404"), { status: 404 }))
    mockVsCreate.mockResolvedValueOnce({ id: "vs-1", status: "completed" })

    await syncLore()
    expect(mockFilesRetrieve).toHaveBeenCalledWith("old-405-file")
  })

  it("Yandex: throws when 405 on delete and retrieve confirms file still exists", async () => {
    setupDb({
      apiKey: "yandex-key",
      folderId: "folder-1",
      nodes: [
        {
          id: 1,
          parent_id: null,
          title: "EmptyNode",
          content: null,
          word_count: 0,
          ai_sync_info: JSON.stringify({
            yandex: { last_synced_at: "2024-01-01T00:00:00.000Z", file_id: "still-there" },
          }),
        },
      ],
    })

    // delete returns 405
    mockFilesDel.mockRejectedValueOnce(Object.assign(new Error("HTTP 405"), { status: 405 }))
    // retrieve succeeds в†’ file still present
    mockFilesRetrieve.mockResolvedValueOnce({ id: "still-there" })

    await expect(syncLore()).rejects.toThrow(/405/)
  })
})
