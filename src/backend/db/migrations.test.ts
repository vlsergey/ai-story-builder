import fs from "node:fs"
import path from "node:path"
import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"
import { CURRENT_VERSION, migrateDatabase } from "./migrations.js"

function inMemoryDb() {
  return new Database(":memory:")
}

/** Tables with their columns, indexes and foreign keys — what a query can tell apart. */
function describeSchema(db: Database.Database) {
  const tables = (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[]
  ).map((r) => r.name)
  return tables.map((table) => ({
    table,
    columns: (db.pragma(`table_info(${table})`) as Record<string, unknown>[])
      .map(({ name, type, notnull, dflt_value, pk }) => ({ name, type, notnull, dflt_value, pk }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))),
    indexes: (db.pragma(`index_list(${table})`) as { name: string; unique: number }[])
      .filter((index) => !index.name.startsWith("sqlite_autoindex"))
      .map((index) => ({
        name: index.name,
        unique: index.unique,
        columns: (db.pragma(`index_info(${index.name})`) as { name: string }[]).map((c) => c.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    foreignKeys: (db.pragma(`foreign_key_list(${table})`) as Record<string, unknown>[]).map(
      ({ table: target, from, to, on_delete }) => ({ target, from, to, on_delete }),
    ),
  }))
}

describe("migrateDatabase", () => {
  it("applies all migrations without throwing", () => {
    const db = inMemoryDb()
    expect(() => migrateDatabase(db)).not.toThrow()
    db.close()
  })

  it("sets user_version to CURRENT_VERSION after migration", () => {
    const db = inMemoryDb()
    migrateDatabase(db)
    const version = db.pragma("user_version", { simple: true }) as number
    expect(version).toBe(CURRENT_VERSION)
    db.close()
  })

  it("is idempotent: running twice does not throw or change version", () => {
    const db = inMemoryDb()
    migrateDatabase(db)
    expect(() => migrateDatabase(db)).not.toThrow()
    const version = db.pragma("user_version", { simple: true }) as number
    expect(version).toBe(CURRENT_VERSION)
    db.close()
  })

  it("creates all expected tables", () => {
    const db = inMemoryDb()
    migrateDatabase(db)

    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]
    ).map((r) => r.name)

    expect(tables).toContain("lore_nodes")
    expect(tables).not.toContain("lore_versions")
    expect(tables).toContain("plan_nodes")
    expect(tables).toContain("plan_edges")
    expect(tables).not.toContain("plan_node_versions")
    expect(tables).toContain("story_parts")
    expect(tables).toContain("card_definitions")
    expect(tables).toContain("card_values")
    expect(tables).not.toContain("ai_calls") // dropped in migration v10→v11
    expect(tables).toContain("settings")

    db.close()
  })

  it("can insert and query rows after migration", () => {
    const db = inMemoryDb()
    migrateDatabase(db)

    db.prepare("INSERT INTO settings (key, value) VALUES ('test_key', 'test_val')").run()
    const row = db.prepare("SELECT value FROM settings WHERE key = 'test_key'").get() as { value: string }
    expect(row.value).toBe("test_val")

    db.close()
  })

  it("builds the same schema by running the chain as schema.sql gives a fresh database", () => {
    // The test below compares schema.sql with itself — a fresh database loads
    // it. This one checks that the chain of migrations ends where schema.sql is.
    const chained = inMemoryDb()
    migrateDatabase(chained, { enforceMigrations: true })
    const fresh = inMemoryDb()
    migrateDatabase(fresh)

    expect(describeSchema(chained)).toEqual(describeSchema(fresh))
    chained.close()
    fresh.close()
  })

  it("stops at the version asked for", () => {
    const db = inMemoryDb()
    migrateDatabase(db, { toVersion: CURRENT_VERSION - 1 })
    expect(db.pragma("user_version", { simple: true })).toBe(CURRENT_VERSION - 1)
    migrateDatabase(db)
    expect(db.pragma("user_version", { simple: true })).toBe(CURRENT_VERSION)
    db.close()
  })

  it("schema matches schema.sql file", () => {
    const db = inMemoryDb()
    migrateDatabase(db)

    // Generate schema from the database
    const rows = db
      .prepare(`
      SELECT type, name, sql
      FROM sqlite_master
      WHERE sql IS NOT NULL
        AND name NOT LIKE 'sqlite_%'
      ORDER BY
        CASE type
          WHEN 'table' THEN 0
          WHEN 'index' THEN 1
          ELSE 2
        END,
        name
    `)
      .all() as Array<{ type: string; name: string; sql: string }>

    let generated = `${rows
      .map((row) => {
        let sql = row.sql.trim()
        if (!sql.endsWith(";")) sql += ";"
        return sql
      })
      .join("\n\n")}\n`
    // Normalize line endings to \n for consistent comparison
    generated = generated.replace(/\r\n/g, "\n").replace(/\r/g, "\n")

    // Read the stored schema file
    const schemaPath = path.resolve(__dirname, "schema.sql")
    const stored = fs.readFileSync(schemaPath, "utf-8")
    // Remove the header comment (first three lines)
    // Support both \n and \r\n line endings
    let storedSchema = `${stored.replace(/^--.*\r?\n/gm, "").trim()}\n`
    // Normalize line endings to \n for consistent comparison
    storedSchema = storedSchema.replace(/\r\n/g, "\n").replace(/\r/g, "\n")

    expect(generated).toBe(storedSchema)
    db.close()
  })
})
