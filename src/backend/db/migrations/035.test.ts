import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { migrateDatabase } from "../migrations.js"
import migration035 from "./035.js"

/** A database at version 34, built by the chain, to seed with parallel loops. */
function at34(): Database.Database {
  const db = new Database(":memory:")
  migrateDatabase(db, { enforceMigrations: true, toVersion: 34 })
  db.pragma("foreign_keys = OFF")
  return db
}

function node(db: Database.Database, id: number, type: string, parent: number | null = null): void {
  db.prepare("INSERT INTO plan_nodes (id, parent_id, title, type, position) VALUES (?, ?, ?, ?, ?)").run(
    id,
    parent,
    `n${id}`,
    type,
    id,
  )
}

function put(db: Database.Database, nodeId: number, path: string, content: string | null, status = "GENERATED"): void {
  db.prepare("INSERT INTO plan_node_states (node_id, path, content, status, rev) VALUES (?, ?, ?, ?, ?)").run(
    nodeId,
    path,
    content,
    status,
    `rev-${nodeId}-${path}`,
  )
}

/** A parallel loop's content: the key of each element, in list order. */
const keyed = (...order: string[]) => JSON.stringify({ keyLength: 6, hashes: {}, order })

/** Every row, as `node@path: content`. */
function rows(db: Database.Database): string[] {
  return (
    db.prepare("SELECT node_id, path, content FROM plan_node_states ORDER BY node_id, path").all() as {
      node_id: number
      path: string
      content: string | null
    }[]
  ).map((r) => `${r.node_id}@${r.path}: ${r.content}`)
}

const typeOf = (db: Database.Database, id: number) =>
  (db.prepare("SELECT type FROM plan_nodes WHERE id = ?").get(id) as { type: string }).type

/** A parallel loop (#10) over a list, with its input (#11), a profile (#12) and its output (#13). */
function characterLoop(db: Database.Database, parent: number | null = null): void {
  node(db, 10, "parallel", parent)
  node(db, 11, "for-each-input", 10)
  node(db, 12, "text", 10)
  node(db, 13, "for-each-output", 10)
}

describe("migration 035: a parallel loop becomes a for-each", () => {
  let db: Database.Database
  beforeEach(() => {
    db = at34()
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })
  afterEach(() => {
    db.close()
    vi.restoreAllMocks()
  })

  it("keys each iteration by the position of its element, keeping what it produced", () => {
    characterLoop(db)
    put(db, 10, "", keyed("aaaaaa", "bbbbbb"))
    for (const [key, name] of [
      ["aaaaaa", "Аня"],
      ["bbbbbb", "Боря"],
    ]) {
      put(db, 11, `10:${key}`, name)
      put(db, 12, `10:${key}`, `Профиль: ${name}`)
      put(db, 13, `10:${key}`, `Профиль: ${name}`)
    }

    migration035(db)

    expect(typeOf(db, 10)).toBe("for-each")
    expect(rows(db)).toEqual([
      '10@: {"length":2}',
      "11@10:0: Аня",
      "11@10:1: Боря",
      "12@10:0: Профиль: Аня",
      "12@10:1: Профиль: Боря",
      "13@10:0: Профиль: Аня",
      "13@10:1: Профиль: Боря",
    ])
  })

  it("gives an element listed twice its own iteration at each place, both with what it produced", () => {
    characterLoop(db)
    put(db, 10, "", keyed("aaaaaa", "bbbbbb", "aaaaaa"))
    put(db, 12, "10:aaaaaa", "Профиль: Аня")
    put(db, 12, "10:bbbbbb", "Профиль: Боря")

    migration035(db)

    expect(rows(db)).toEqual([
      '10@: {"length":3}',
      "12@10:0: Профиль: Аня",
      "12@10:1: Профиль: Боря",
      "12@10:2: Профиль: Аня",
    ])
    const revs = db.prepare("SELECT rev FROM plan_node_states WHERE node_id = 12").all() as { rev: string }[]
    expect(new Set(revs.map((r) => r.rev)).size, "every moved row gets its own revision").toBe(3)
  })

  it("drops an iteration whose element the loop no longer lists", () => {
    characterLoop(db)
    put(db, 10, "", keyed("bbbbbb"))
    put(db, 12, "10:aaaaaa", "Профиль: Аня")
    put(db, 12, "10:bbbbbb", "Профиль: Боря")

    migration035(db)

    expect(rows(db)).toEqual(['10@: {"length":1}', "12@10:0: Профиль: Боря"])
  })

  it("gives a loop that never ran no iterations, and drops whatever sat under it", () => {
    characterLoop(db)
    put(db, 12, "10:aaaaaa", "Профиль: Аня")

    migration035(db)

    expect(typeOf(db, 10)).toBe("for-each")
    expect(rows(db)).toEqual([])
  })

  it("moves each iteration of a loop nested in a for-each by its own list", () => {
    node(db, 5, "for-each")
    characterLoop(db, 5)
    put(db, 5, "", JSON.stringify({ length: 2 }))
    put(db, 10, "5:0", keyed("aaaaaa", "bbbbbb"))
    put(db, 10, "5:1", keyed("bbbbbb"))
    put(db, 12, "5:0/10:aaaaaa", "A0")
    put(db, 12, "5:0/10:bbbbbb", "B0")
    put(db, 12, "5:1/10:bbbbbb", "B1")

    migration035(db)

    expect(rows(db)).toEqual([
      '5@: {"length":2}',
      '10@5:0: {"length":2}',
      '10@5:1: {"length":1}',
      "12@5:0/10:0: A0",
      "12@5:0/10:1: B0",
      "12@5:1/10:0: B1",
    ])
  })

  it("moves what a loop inside a parallel one produced along with its iteration", () => {
    characterLoop(db)
    node(db, 20, "for-each", 10)
    node(db, 21, "text", 20)
    put(db, 10, "", keyed("bbbbbb", "aaaaaa"))
    put(db, 20, "10:aaaaaa", JSON.stringify({ length: 1 }))
    put(db, 21, "10:aaaaaa/20:0", "сцена Ани")

    migration035(db)

    expect(rows(db)).toEqual(['10@: {"length":2}', '20@10:1: {"length":1}', "21@10:1/20:0: сцена Ани"])
  })

  it("leaves everything outside parallel loops as it was", () => {
    node(db, 1, "text")
    node(db, 5, "for-each")
    node(db, 6, "text", 5)
    put(db, 1, "", "Синопсис")
    put(db, 5, "", JSON.stringify({ length: 1 }))
    put(db, 6, "5:0", "Глава")
    const before = db.prepare("SELECT * FROM plan_node_states ORDER BY node_id, path").all()

    migration035(db)

    expect(db.prepare("SELECT * FROM plan_node_states ORDER BY node_id, path").all()).toEqual(before)
    expect(typeOf(db, 5)).toBe("for-each")
  })

  it("reads unreadable content as a loop that never ran, and says so", () => {
    characterLoop(db)
    put(db, 10, "", "{not json")
    put(db, 12, "10:aaaaaa", "Профиль: Аня")

    migration035(db)

    expect(rows(db)).toEqual(['10@: {"length":0}'])
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("n10"))
  })

  it("does nothing the second time", () => {
    characterLoop(db)
    put(db, 10, "", keyed("aaaaaa"))
    put(db, 12, "10:aaaaaa", "Профиль: Аня")
    migration035(db)
    const once = rows(db)

    migration035(db)

    expect(rows(db)).toEqual(once)
  })

  it("is the step from version 34 to 35", () => {
    characterLoop(db)
    put(db, 10, "", keyed("aaaaaa"))
    put(db, 12, "10:aaaaaa", "Профиль: Аня")

    migrateDatabase(db)

    expect(db.pragma("user_version", { simple: true })).toBe(35)
    expect(rows(db)).toEqual(['10@: {"length":1}', "12@10:0: Профиль: Аня"])
  })
})
