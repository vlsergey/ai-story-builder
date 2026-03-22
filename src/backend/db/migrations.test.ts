import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { migrateDatabase, CURRENT_VERSION } from './migrations.js'
import fs from 'fs'
import path from 'path'

function inMemoryDb() {
  return new Database(':memory:')
}

describe('migrateDatabase', () => {
  it('applies all migrations without throwing', () => {
    const db = inMemoryDb()
    expect(() => migrateDatabase(db)).not.toThrow()
    db.close()
  })

  it('sets user_version to CURRENT_VERSION after migration', () => {
    const db = inMemoryDb()
    migrateDatabase(db)
    const version = db.pragma('user_version', { simple: true }) as number
    expect(version).toBe(CURRENT_VERSION)
    db.close()
  })

  it('is idempotent: running twice does not throw or change version', () => {
    const db = inMemoryDb()
    migrateDatabase(db)
    expect(() => migrateDatabase(db)).not.toThrow()
    const version = db.pragma('user_version', { simple: true }) as number
    expect(version).toBe(CURRENT_VERSION)
    db.close()
  })

  it('creates all expected tables', () => {
    const db = inMemoryDb()
    migrateDatabase(db)

    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]
    ).map((r) => r.name)

    expect(tables).toContain('lore_nodes')
    expect(tables).not.toContain('lore_versions')
    expect(tables).toContain('plan_nodes')
    expect(tables).toContain('plan_edges')
    expect(tables).not.toContain('plan_node_versions')
    expect(tables).toContain('story_parts')
    expect(tables).toContain('card_definitions')
    expect(tables).toContain('card_values')
    expect(tables).not.toContain('ai_calls') // dropped in migration v10→v11
    expect(tables).toContain('settings')

    db.close()
  })

  it('can insert and query rows after migration', () => {
    const db = inMemoryDb()
    migrateDatabase(db)

    db.prepare("INSERT INTO settings (key, value) VALUES ('test_key', 'test_val')").run()
    const row = db.prepare("SELECT value FROM settings WHERE key = 'test_key'").get() as { value: string }
    expect(row.value).toBe('test_val')

    db.close()
  })

  it('schema matches schema.sql file', () => {
    const db = inMemoryDb()
    migrateDatabase(db)

    // Generate schema from the database
    const rows = db.prepare(`
      SELECT type, name, sql
      FROM sqlite_master
      WHERE sql IS NOT NULL
        AND name NOT LIKE 'sqlite_%'
      ORDER BY type, name
    `).all() as Array<{ type: string; name: string; sql: string }>

    const generated = rows
      .map(row => {
        let sql = row.sql.trim()
        if (!sql.endsWith(';')) sql += ';'
        return sql
      })
      .join('\n\n') + '\n'

    // Read the stored schema file
    const schemaPath = path.resolve(__dirname, 'schema.sql')
    const stored = fs.readFileSync(schemaPath, 'utf-8')
    // Remove the header comment (first three lines)
    const storedSchema = stored.replace(/^--.*\n/gm, '').trim() + '\n'

    expect(generated).toBe(storedSchema)
    db.close()
  })
})
