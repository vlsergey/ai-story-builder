import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"
import { migrateDatabase } from "../migrations.js"
import migration027 from "./027.js"

function seededDbAt26(): Database.Database {
  const db = new Database(":memory:")
  // Run forward to version 26, then we'll apply 027 manually so we can inspect
  // the pre-state more easily. Simpler: run all migrations, then walk back is
  // impossible — instead, seed at version 0 via schema and let the full chain
  // run through 26 by stopping the loop early. Easiest: just run migrateDatabase
  // (advances to CURRENT_VERSION which already includes 027), and seed BEFORE
  // applying — using an explicit pre-027 state via raw SQL.
  return db
}

function setupAt26(db: Database.Database) {
  // Manually run migrations 0..CURRENT_VERSION so we can insert split rows in
  // their legacy shape, then apply 027 in isolation to assert translation.
  db.pragma("foreign_keys = OFF")
  migrateDatabase(db, true)
  // Now we're at CURRENT_VERSION. Wipe data and resurrect any columns dropped
  // by migrations >27 so seeding pre-027 rows still works.
  db.exec("DELETE FROM plan_nodes")
  const cols = (db.pragma("table_info(plan_nodes)") as { name: string }[]).map((c) => c.name)
  if (!cols.includes("ai_user_prompt")) db.exec("ALTER TABLE plan_nodes ADD COLUMN ai_user_prompt TEXT")
  if (!cols.includes("ai_system_prompt")) db.exec("ALTER TABLE plan_nodes ADD COLUMN ai_system_prompt TEXT")
  db.pragma("user_version = 26")
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
    const db = seededDbAt26()
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
    const db = seededDbAt26()
    setupAt26(db)
    insertSplitNode(db, { id: 2, title: "By Number", settings: { separator: "^\\d+\\. ", dropFirst: 0, dropLast: 0 } })

    migration027(db)
    const row = readSplit(db, 2)

    expect(row.ai_user_prompt).toMatch(/numbered list/i)
    db.close()
  })

  it("falls back to quoting the regex for unknown patterns", () => {
    const db = seededDbAt26()
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
    const db = seededDbAt26()
    setupAt26(db)
    insertSplitNode(db, { id: 4, title: "Drop Both", settings: { separator: "^## ", dropFirst: 2, dropLast: 1 } })

    migration027(db)
    const row = readSplit(db, 4)

    expect(row.ai_user_prompt).toMatch(/drop the first 2 .*parts/i)
    expect(row.ai_user_prompt).toMatch(/drop the last 1 .*part/i)
    db.close()
  })

  it("preserves an existing ai_user_prompt by appending the translation", () => {
    const db = seededDbAt26()
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
    const db = seededDbAt26()
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
    const db = seededDbAt26()
    setupAt26(db)
    db.prepare(
      `INSERT INTO plan_nodes (id, title, type, node_type_settings, ai_user_prompt, status)
       VALUES (?, ?, 'text', ?, ?, 'GENERATED')`,
    ).run(99, "A text node", JSON.stringify({ foo: "bar" }), "Keep me intact")

    migration027(db)

    const row = db
      .prepare(`SELECT node_type_settings, ai_user_prompt FROM plan_nodes WHERE id = 99`)
      .get() as { node_type_settings: string | null; ai_user_prompt: string | null }
    expect(row.node_type_settings).toBe(JSON.stringify({ foo: "bar" }))
    expect(row.ai_user_prompt).toBe("Keep me intact")
    db.close()
  })
})
