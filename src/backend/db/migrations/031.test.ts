import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { migrateDatabase } from "../migrations.js"
import migration031 from "./031.js"

function setupAt30(db: Database.Database) {
  db.pragma("foreign_keys = OFF")
  migrateDatabase(db, true)
  // migrateDatabase advanced through 031 already; drop the new column to
  // revert to the pre-031 shape so this test exercises migration031 directly.
  db.exec("ALTER TABLE ai_call_stats DROP COLUMN reasoning_effort")
  db.pragma("user_version = 30")
}

describe("migration 031 — reasoning_effort column", () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(":memory:")
    setupAt30(db)
  })

  afterEach(() => {
    db.close()
  })

  it("adds reasoning_effort column as TEXT", () => {
    migration031(db)
    const cols = (db.pragma("table_info(ai_call_stats)") as { name: string; type: string }[]).filter(
      (c) => c.name === "reasoning_effort",
    )
    expect(cols).toHaveLength(1)
    expect(cols[0].type.toUpperCase()).toBe("TEXT")
  })

  it("accepts null and standard values", () => {
    migration031(db)
    const insert = db.prepare(`INSERT INTO ai_call_stats (
        ts, run_id, engine_id, model, purpose,
        instructions_chars, input_chars, output_chars,
        duration_ms, success, reasoning_effort
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    insert.run("2026-05-15T00:00:00Z", "r1", "grok", "grok-4", "x", 0, 0, 0, 0, 1, null)
    insert.run("2026-05-15T00:00:01Z", "r1", "grok", "grok-4", "x", 0, 0, 0, 0, 1, "high")
    insert.run("2026-05-15T00:00:02Z", "r1", "grok", "grok-4", "x", 0, 0, 0, 0, 1, "none")

    const rows = db.prepare("SELECT reasoning_effort FROM ai_call_stats ORDER BY ts").all() as Array<{
      reasoning_effort: string | null
    }>
    expect(rows.map((r) => r.reasoning_effort)).toEqual([null, "high", "none"])
  })
})
