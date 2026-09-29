import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { migrateDatabase } from "../migrations.js"
import migration032 from "./032.js"

function readAiConfig(db: Database.Database): Record<string, Record<string, unknown>> {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'ai_config'").get() as { value: string } | undefined
  return row ? JSON.parse(row.value) : {}
}

function writeAiConfig(db: Database.Database, config: unknown) {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_config', ?)").run(JSON.stringify(config))
}

function insertNode(db: Database.Database, title: string, aiSettings: string | null): number {
  return Number(
    db.prepare("INSERT INTO plan_nodes (title, ai_settings) VALUES (?, ?)").run(title, aiSettings).lastInsertRowid,
  )
}

function nodeSettings(db: Database.Database, id: number): string | null {
  return (db.prepare("SELECT ai_settings FROM plan_nodes WHERE id = ?").get(id) as { ai_settings: string | null })
    .ai_settings
}

describe("migration 032 — a stored zero was an empty field", () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(":memory:")
    db.pragma("foreign_keys = OFF")
    migrateDatabase(db, true)
  })

  afterEach(() => db.close())

  it("drops the zeros the settings form wrote for empty fields", () => {
    // The exact shape found in five real projects.
    writeAiConfig(db, {
      grok: {
        api_key: "k",
        defaultAiGenerationSettings: {
          model: "grok-4.3",
          max_output_tokens: 0,
          temperature: 0,
          top_p: 0,
          x_search: false,
          web_search: true,
          reasoning_effort: "medium",
        },
      },
    })
    migration032(db)
    expect(readAiConfig(db).grok.defaultAiGenerationSettings).toEqual({
      model: "grok-4.3",
      x_search: false,
      web_search: true,
      reasoning_effort: "medium",
    })
  })

  it("keeps every non-zero number — those are real choices", () => {
    writeAiConfig(db, {
      ollama: { defaultAiGenerationSettings: { num_ctx: 65536, temperature: 1, top_p: 0.9, max_output_tokens: 6000 } },
      grok: { summaryAiGenerationSettings: { temperature: 0.5, top_p: 0 } },
    })
    migration032(db)
    const cfg = readAiConfig(db)
    expect(cfg.ollama.defaultAiGenerationSettings).toEqual({
      num_ctx: 65536,
      temperature: 1,
      top_p: 0.9,
      max_output_tokens: 6000,
    })
    expect(cfg.grok.summaryAiGenerationSettings).toEqual({ temperature: 0.5 })
  })

  it("covers every settings object an engine config carries, and the Yandex keys", () => {
    writeAiConfig(db, {
      yandex: {
        folder_id: "f",
        defaultAiSettings: { max_completion_tokens: 0, maxCompletionTokens: 0, webSearch: "none" },
        defaultAiGenerationSettings: { max_completion_tokens: 0 },
      },
    })
    migration032(db)
    const y = readAiConfig(db).yandex
    expect(y.defaultAiSettings).toEqual({ webSearch: "none" })
    expect(y.defaultAiGenerationSettings).toEqual({})
    expect(y.folder_id).toBe("f")
  })

  it("leaves unrelated keys alone even when they are zero", () => {
    // Only the sampling and budget knobs had the empty-means-zero problem.
    writeAiConfig(db, { grok: { defaultAiGenerationSettings: { some_future_counter: 0, temperature: 0 } } })
    migration032(db)
    expect(readAiConfig(db).grok.defaultAiGenerationSettings).toEqual({ some_future_counter: 0 })
  })

  it("cleans per-node overrides the same way", () => {
    const zeroed = insertNode(db, "A", JSON.stringify({ grok: { model: "x", temperature: 0 } }))
    const real = insertNode(db, "B", JSON.stringify({ grok: { temperature: 0.9 } }))
    const none = insertNode(db, "C", null)
    migration032(db)
    expect(JSON.parse(nodeSettings(db, zeroed) ?? "{}")).toEqual({ grok: { model: "x" } })
    expect(JSON.parse(nodeSettings(db, real) ?? "{}")).toEqual({ grok: { temperature: 0.9 } })
    expect(nodeSettings(db, none)).toBeNull()
  })

  it("survives a node whose override is not JSON", () => {
    const broken = insertNode(db, "D", "{not json")
    expect(() => migration032(db)).not.toThrow()
    expect(nodeSettings(db, broken)).toBe("{not json")
  })

  it("is a no-op on a project without an engine config", () => {
    expect(() => migration032(db)).not.toThrow()
    expect(db.prepare("SELECT value FROM settings WHERE key = 'ai_config'").get()).toBeUndefined()
  })

  it("is idempotent", () => {
    writeAiConfig(db, { grok: { defaultAiGenerationSettings: { temperature: 0, model: "m" } } })
    migration032(db)
    migration032(db)
    expect(readAiConfig(db).grok.defaultAiGenerationSettings).toEqual({ model: "m" })
  })
})
