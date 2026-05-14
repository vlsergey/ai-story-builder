import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { migrateDatabase } from "../migrations.js"
import migration029 from "./029.js"

function setupAt28(db: Database.Database) {
  db.pragma("foreign_keys = OFF")
  migrateDatabase(db, true)
  // migrateDatabase advanced through 029 already; drop the new tables to revert
  // to the pre-029 shape so this test can exercise migration029 directly.
  db.exec("DROP TABLE IF EXISTS ai_call_stats")
  db.exec("DROP TABLE IF EXISTS ai_run_stats")
  db.pragma("user_version = 28")
}

describe("migration 029 — ai_call_stats + ai_run_stats", () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(":memory:")
    setupAt28(db)
  })

  afterEach(() => {
    db.close()
  })

  it("creates ai_call_stats with expected columns", () => {
    migration029(db)
    const cols = (db.pragma("table_info(ai_call_stats)") as { name: string }[]).map((c) => c.name)
    expect(cols).toEqual(
      expect.arrayContaining([
        "id",
        "ts",
        "run_id",
        "engine_id",
        "model",
        "purpose",
        "prompt_cache_keys",
        "node_title",
        "node_type",
        "instructions_chars",
        "input_chars",
        "output_chars",
        "input_tokens",
        "output_tokens",
        "cached_prompt_tokens",
        "duration_ms",
        "cost_usd",
        "success",
        "error_message",
      ]),
    )
  })

  it("creates ai_run_stats with expected columns and a unique index on run_id", () => {
    migration029(db)
    const cols = (db.pragma("table_info(ai_run_stats)") as { name: string }[]).map((c) => c.name)
    expect(cols).toEqual(
      expect.arrayContaining([
        "id",
        "run_id",
        "started_at",
        "finished_at",
        "wall_time_ms",
        "template_file",
        "engine_id",
        "model",
        "total_calls",
        "calls_by_purpose",
        "sum_durations_ms",
        "total_input_tokens",
        "total_output_tokens",
        "total_cached_prompt_tokens",
        "cost_usd",
        "success",
      ]),
    )

    // run_id should be unique
    db.prepare("INSERT INTO ai_run_stats (run_id, started_at) VALUES (?, ?)").run("r1", "2026-05-14T00:00:00Z")
    expect(() =>
      db.prepare("INSERT INTO ai_run_stats (run_id, started_at) VALUES (?, ?)").run("r1", "2026-05-14T00:01:00Z"),
    ).toThrow(/UNIQUE/)
  })

  it("call_stats index on (node_type, purpose, engine_id, model) exists", () => {
    migration029(db)
    const indexes = (db.pragma("index_list(ai_call_stats)") as { name: string }[]).map((i) => i.name)
    expect(indexes).toContain("idx_ai_call_stats_lookup")
    expect(indexes).toContain("idx_ai_call_stats_run")
  })
})
