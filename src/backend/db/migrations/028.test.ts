import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { migrateDatabase } from "../migrations.js"
import migration028 from "./028.js"

function setupAt27(db: Database.Database) {
  db.pragma("foreign_keys = OFF")
  migrateDatabase(db, true)
  db.exec("DELETE FROM plan_nodes")
  // migrateDatabase advanced through 028, which dropped the prompt columns.
  // Re-add them so the test can seed pre-028 data and exercise the migration.
  db.exec("ALTER TABLE plan_nodes ADD COLUMN ai_user_prompt TEXT")
  db.exec("ALTER TABLE plan_nodes ADD COLUMN ai_system_prompt TEXT")
  db.pragma("user_version = 27")
}

function insertNode(
  db: Database.Database,
  args: {
    id: number
    title: string
    type: string
    aiUserPrompt?: string | null
    aiSystemPrompt?: string | null
    nodeTypeSettings?: object | null
  },
): void {
  db.prepare(
    `INSERT INTO plan_nodes (id, title, type, ai_user_prompt, ai_system_prompt, node_type_settings, status)
     VALUES (@id, @title, @type, @aup, @asp, @nts, 'GENERATED')`,
  ).run({
    id: args.id,
    title: args.title,
    type: args.type,
    aup: args.aiUserPrompt ?? null,
    asp: args.aiSystemPrompt ?? null,
    nts: args.nodeTypeSettings === undefined ? null : JSON.stringify(args.nodeTypeSettings),
  })
}

function readSettings(db: Database.Database, id: number): Record<string, unknown> | null {
  const row = db.prepare(`SELECT node_type_settings FROM plan_nodes WHERE id = ?`).get(id) as
    | { node_type_settings: string | null }
    | undefined
  if (!row?.node_type_settings) return null
  return JSON.parse(row.node_type_settings) as Record<string, unknown>
}

function hasCol(db: Database.Database, name: string): boolean {
  const cols = (db.pragma("table_info(plan_nodes)") as { name: string }[]).map((c) => c.name)
  return cols.includes(name)
}

describe("migration 028: ai_user_prompt/ai_system_prompt → node_type_settings", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it("migrates prompts into node_type_settings for text nodes", () => {
    const db = new Database(":memory:")
    setupAt27(db)
    insertNode(db, {
      id: 1,
      title: "T",
      type: "text",
      aiUserPrompt: "Write a poem",
      aiSystemPrompt: "You are a poet",
    })

    migration028(db)

    expect(readSettings(db, 1)).toEqual({ userPrompt: "Write a poem", systemPrompt: "You are a poet" })
    db.close()
  })

  it("preserves existing node_type_settings keys when merging prompts in", () => {
    const db = new Database(":memory:")
    setupAt27(db)
    insertNode(db, {
      id: 2,
      title: "S",
      type: "split",
      aiUserPrompt: "Split by paragraphs",
      nodeTypeSettings: { existingKey: "keep me" },
    })

    migration028(db)

    expect(readSettings(db, 2)).toEqual({ existingKey: "keep me", userPrompt: "Split by paragraphs" })
    db.close()
  })

  it("migrates prompts for lore nodes (as a plan-node type)", () => {
    const db = new Database(":memory:")
    setupAt27(db)
    insertNode(db, { id: 3, title: "L", type: "lore", aiUserPrompt: "Describe the world" })

    migration028(db)

    expect(readSettings(db, 3)).toEqual({ userPrompt: "Describe the world" })
    db.close()
  })

  it("drops prompts on non-LLM types and logs a warning with the original value", () => {
    const db = new Database(":memory:")
    setupAt27(db)
    insertNode(db, {
      id: 4,
      title: "M",
      type: "merge",
      aiUserPrompt: "stray prompt that should not be here",
    })

    migration028(db)

    // node_type_settings remains untouched (still NULL — no destination for the dropped data)
    expect(readSettings(db, 4)).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
    const allWarnText = warnSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n")
    expect(allWarnText).toContain("id=4")
    expect(allWarnText).toContain("type=merge")
    expect(allWarnText).toContain("stray prompt that should not be here")
    db.close()
  })

  it("drops prompts on for-each types and warns", () => {
    const db = new Database(":memory:")
    setupAt27(db)
    insertNode(db, { id: 5, title: "FE", type: "for-each", aiSystemPrompt: "leftover system" })

    migration028(db)

    expect(readSettings(db, 5)).toBeNull()
    const allWarnText = warnSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n")
    expect(allWarnText).toContain("type=for-each")
    expect(allWarnText).toContain("leftover system")
    db.close()
  })

  it("drops prompts on fix-problems even though it's an LLM type (uses its own settings keys)", () => {
    const db = new Database(":memory:")
    setupAt27(db)
    insertNode(db, {
      id: 6,
      title: "FP",
      type: "fix-problems",
      aiUserPrompt: "stale row-level prompt",
      nodeTypeSettings: { aiUserInstructionsToFindProblems: ["find issues"] },
    })

    migration028(db)

    // fix-problems keeps its own structured settings; row-level prompt is dropped+warned.
    expect(readSettings(db, 6)).toEqual({ aiUserInstructionsToFindProblems: ["find issues"] })
    const allWarnText = warnSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n")
    expect(allWarnText).toContain("type=fix-problems")
    expect(allWarnText).toContain("stale row-level prompt")
    db.close()
  })

  it("drops the ai_user_prompt and ai_system_prompt columns from plan_nodes", () => {
    const db = new Database(":memory:")
    setupAt27(db)
    expect(hasCol(db, "ai_user_prompt")).toBe(true)
    expect(hasCol(db, "ai_system_prompt")).toBe(true)

    migration028(db)

    expect(hasCol(db, "ai_user_prompt")).toBe(false)
    expect(hasCol(db, "ai_system_prompt")).toBe(false)
    db.close()
  })

  it("is idempotent: re-running on an already-migrated DB is a no-op", () => {
    const db = new Database(":memory:")
    setupAt27(db)
    insertNode(db, { id: 7, title: "T", type: "text", aiUserPrompt: "x" })

    migration028(db)
    expect(() => migration028(db)).not.toThrow()
    expect(readSettings(db, 7)).toEqual({ userPrompt: "x" })
    db.close()
  })

  it("recovers from corrupt node_type_settings JSON by overwriting with prompts only", () => {
    const db = new Database(":memory:")
    setupAt27(db)
    // Insert raw bad JSON
    db.prepare(
      `INSERT INTO plan_nodes (id, title, type, ai_user_prompt, node_type_settings, status)
       VALUES (8, 'broken', 'text', 'recovered prompt', '{not-valid-json', 'GENERATED')`,
    ).run()

    migration028(db)

    expect(readSettings(db, 8)).toEqual({ userPrompt: "recovered prompt" })
    db.close()
  })
})
