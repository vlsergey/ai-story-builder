import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"
import { migrateDatabase } from "../migrations.js"
import migration027 from "./027.js"

/** A database at version 26, built by the chain, to seed with pre-027 rows. */
function setupAt26(db: Database.Database) {
  db.pragma("foreign_keys = OFF")
  migrateDatabase(db, { enforceMigrations: true, toVersion: 26 })
}

function insertSplitNode(
  db: Database.Database,
  args: { id: number; title: string; settings: object; aiUserPrompt?: string | null; status?: string },
): void {
  db.prepare(
    `INSERT INTO plan_nodes (id, title, type, node_type_settings, ai_user_prompt, status)
     VALUES (@id, @title, 'split', @settings, @aiUserPrompt, @status)`,
  ).run({
    id: args.id,
    title: args.title,
    settings: JSON.stringify(args.settings),
    aiUserPrompt: args.aiUserPrompt ?? null,
    status: args.status ?? "GENERATED",
  })
}

function readSplit(db: Database.Database, id: number) {
  return db
    .prepare(
      `SELECT id, title, type, node_type_settings, ai_user_prompt, status
         FROM plan_nodes WHERE id = ?`,
    )
    .get(id) as {
    id: number
    title: string
    type: string
    node_type_settings: string | null
    ai_user_prompt: string | null
    status: string
  }
}

describe("migration 027: regex split → LLM split", () => {
  it("translates a markdown-heading regex into a friendly prompt", () => {
    const db = new Database(":memory:")
    setupAt26(db)
    insertSplitNode(db, { id: 1, title: "By Heading", settings: { separator: "^## ", dropFirst: 0, dropLast: 0 } })

    migration027(db)
    const row = readSplit(db, 1)

    expect(row.node_type_settings).toBeNull()
    expect(row.ai_user_prompt).toMatch(/Markdown headings/i)
    expect(row.status).toBe("OUTDATED")
    db.close()
  })

  it("translates a numbered-list regex into a friendly prompt", () => {
    const db = new Database(":memory:")
    setupAt26(db)
    insertSplitNode(db, { id: 2, title: "By Number", settings: { separator: "^\\d+\\. ", dropFirst: 0, dropLast: 0 } })

    migration027(db)
    const row = readSplit(db, 2)

    expect(row.ai_user_prompt).toMatch(/numbered list/i)
    db.close()
  })

  it("falls back to quoting the regex for unknown patterns", () => {
    const db = new Database(":memory:")
    setupAt26(db)
    insertSplitNode(db, {
      id: 3,
      title: "Custom",
      settings: { separator: "(?<=\\.)\\s+(?=[A-Z])", dropFirst: 0, dropLast: 0 },
    })

    migration027(db)
    const row = readSplit(db, 3)

    expect(row.ai_user_prompt).toContain("(?<=\\.)\\s+(?=[A-Z])")
    db.close()
  })

  it("bakes dropFirst and dropLast into the prompt", () => {
    const db = new Database(":memory:")
    setupAt26(db)
    insertSplitNode(db, { id: 4, title: "Drop Both", settings: { separator: "^## ", dropFirst: 2, dropLast: 1 } })

    migration027(db)
    const row = readSplit(db, 4)

    expect(row.ai_user_prompt).toMatch(/drop the first 2 .*parts/i)
    expect(row.ai_user_prompt).toMatch(/drop the last 1 .*part/i)
    db.close()
  })

  it("preserves an existing ai_user_prompt by appending the translation", () => {
    const db = new Database(":memory:")
    setupAt26(db)
    insertSplitNode(db, {
      id: 5,
      title: "With Prompt",
      settings: { separator: "^## ", dropFirst: 0, dropLast: 0 },
      aiUserPrompt: "Manually written hint.",
    })

    migration027(db)
    const row = readSplit(db, 5)

    expect(row.ai_user_prompt).toMatch(/^Manually written hint\./)
    expect(row.ai_user_prompt).toMatch(/Markdown headings/i)
    db.close()
  })

  it("keeps EMPTY and MANUAL statuses unchanged", () => {
    const db = new Database(":memory:")
    setupAt26(db)
    insertSplitNode(db, {
      id: 6,
      title: "Empty",
      settings: { separator: "^## ", dropFirst: 0, dropLast: 0 },
      status: "EMPTY",
    })
    insertSplitNode(db, {
      id: 7,
      title: "Manual",
      settings: { separator: "^## ", dropFirst: 0, dropLast: 0 },
      status: "MANUAL",
    })

    migration027(db)
    expect(readSplit(db, 6).status).toBe("EMPTY")
    expect(readSplit(db, 7).status).toBe("MANUAL")
    db.close()
  })

  it("does nothing to non-split nodes", () => {
    const db = new Database(":memory:")
    setupAt26(db)
    db.prepare(
      `INSERT INTO plan_nodes (id, title, type, node_type_settings, ai_user_prompt, status)
       VALUES (?, ?, 'text', ?, ?, 'GENERATED')`,
    ).run(99, "A text node", JSON.stringify({ foo: "bar" }), "Keep me intact")

    migration027(db)

    const row = db.prepare(`SELECT node_type_settings, ai_user_prompt FROM plan_nodes WHERE id = 99`).get() as {
      node_type_settings: string | null
      ai_user_prompt: string | null
    }
    expect(row.node_type_settings).toBe(JSON.stringify({ foo: "bar" }))
    expect(row.ai_user_prompt).toBe("Keep me intact")
    db.close()
  })
})
