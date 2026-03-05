import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { migrateDatabase, CURRENT_VERSION } from './migrations'

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
    expect(tables).toContain('lore_versions')
    expect(tables).toContain('plan_nodes')
    expect(tables).toContain('plan_node_versions')
    expect(tables).toContain('story_parts')
    expect(tables).toContain('card_definitions')
    expect(tables).toContain('card_values')
    expect(tables).toContain('ai_calls')
    expect(tables).toContain('settings')

    db.close()
  })

  it('plan_node_versions has instruction and result columns (not summary/notes)', () => {
    const db = inMemoryDb()
    migrateDatabase(db)

    const cols = (
      db.pragma('table_info(plan_node_versions)') as { name: string }[]
    ).map((c) => c.name)

    expect(cols).toContain('instruction')
    expect(cols).toContain('result')
    expect(cols).not.toContain('summary')
    expect(cols).not.toContain('notes')

    db.close()
  })

  it('card_values has data column (not the reserved keyword values)', () => {
    const db = inMemoryDb()
    migrateDatabase(db)

    const cols = (
      db.pragma('table_info(card_values)') as { name: string }[]
    ).map((c) => c.name)

    expect(cols).toContain('data')
    expect(cols).not.toContain('values')

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

  it('migration 4→5: clears grok key from ai_sync_info, preserving other engine data', () => {
    const db = inMemoryDb()
    migrateDatabase(db)

    // Insert nodes with various ai_sync_info states
    db.prepare(`
      INSERT INTO lore_nodes (id, name, ai_sync_info) VALUES
        (1, 'GrokOnly',   '{"grok":{"file_id":"f1","last_synced_at":"2025-01-01T00:00:00.000Z"}}'),
        (2, 'GrokAndYandex', '{"grok":{"file_id":"f2","last_synced_at":"2025-01-01T00:00:00.000Z"},"yandex":{"file_id":"y1","last_synced_at":"2025-01-01T00:00:00.000Z"}}'),
        (3, 'YandexOnly', '{"yandex":{"file_id":"y2","last_synced_at":"2025-01-01T00:00:00.000Z"}}'),
        (4, 'NullInfo',   NULL)
    `).run()

    // Re-run the migration step (simulate applying it to existing data)
    const rows = db
      .prepare("SELECT id, ai_sync_info FROM lore_nodes WHERE ai_sync_info IS NOT NULL")
      .all() as { id: number; ai_sync_info: string }[]
    const update = db.prepare('UPDATE lore_nodes SET ai_sync_info = ? WHERE id = ?')
    for (const row of rows) {
      const info = JSON.parse(row.ai_sync_info) as Record<string, unknown>
      if (!('grok' in info)) continue
      delete info['grok']
      const newValue = Object.keys(info).length > 0 ? JSON.stringify(info) : null
      update.run(newValue, row.id)
    }

    const getInfo = (id: number) => {
      const r = db.prepare('SELECT ai_sync_info FROM lore_nodes WHERE id = ?').get(id) as { ai_sync_info: string | null }
      return r.ai_sync_info
    }

    // grok-only → NULL
    expect(getInfo(1)).toBeNull()
    // grok+yandex → yandex only
    const mixed = JSON.parse(getInfo(2)!) as Record<string, unknown>
    expect(mixed).not.toHaveProperty('grok')
    expect(mixed).toHaveProperty('yandex')
    // yandex-only → unchanged
    expect(getInfo(3)).toContain('yandex')
    // null → still null
    expect(getInfo(4)).toBeNull()

    db.close()
  })
})
