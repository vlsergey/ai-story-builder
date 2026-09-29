import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { migrateDatabase } from "../migrations.js"
import migration033 from "./033.js"

/** A database at version 32, built by the chain, to seed with the old layout. */
function at32(): Database.Database {
  const db = new Database(":memory:")
  migrateDatabase(db, { enforceMigrations: true, toVersion: 32 })
  // As while migrating: foreign keys off, so that broken data can be seeded.
  db.pragma("foreign_keys = OFF")
  return db
}

interface OldNode {
  id: number
  parent_id?: number | null
  title?: string
  type?: string
  content?: string | null
  summary?: string | null
  status?: string
  word_count?: number
  in_review?: number
  review_base_content?: string | null
  ai_improve_instruction?: string | null
  position?: number
}

function insert(db: Database.Database, node: OldNode): void {
  db.prepare(
    `INSERT INTO plan_nodes (id, parent_id, title, type, content, summary, status, word_count,
                             in_review, review_base_content, ai_improve_instruction, position)
     VALUES (@id, @parent_id, @title, @type, @content, @summary, @status, @word_count,
             @in_review, @review_base_content, @ai_improve_instruction, @position)`,
  ).run({
    parent_id: null,
    title: `n${node.id}`,
    type: "text",
    content: null,
    summary: null,
    status: "EMPTY",
    word_count: 0,
    in_review: 0,
    review_base_content: null,
    ai_improve_instruction: null,
    position: node.id,
    ...node,
  })
}

function edge(db: Database.Database, from: number, to: number): void {
  db.prepare("INSERT INTO plan_edges (from_node_id, to_node_id, type) VALUES (?, ?, 'text')").run(from, to)
}

/** A snapshot entry as `collectForEachNodeIterationContentFromChildren` wrote it. */
function entry(content: string | null, status = "GENERATED", extra: Record<string, unknown> = {}) {
  return { content, summary: null, word_count: 0, char_count: 0, byte_count: 0, status, ...extra }
}

function loopContent(content: { length?: number; currentIndex?: number; overrides?: unknown[] }): string {
  return JSON.stringify(content)
}

interface NewState {
  node_id: number
  path: string
  content: string | null
  summary: string | null
  status: string
  word_count: number
  in_review: number
  review_base_content: string | null
  ai_improve_instruction: string | null
}

function states(db: Database.Database): NewState[] {
  return db.prepare("SELECT * FROM plan_node_states ORDER BY node_id, path").all() as NewState[]
}

function state(db: Database.Database, nodeId: number, path = ""): NewState | undefined {
  return db.prepare("SELECT * FROM plan_node_states WHERE node_id = ? AND path = ?").get(nodeId, path) as
    | NewState
    | undefined
}

/**
 * What must hold after the migration, whatever the data: every node outside
 * loops has its one row at `''`; a loop's child has rows only in the loop's
 * iterations; a loop keeps only its length.
 */
function checkStateInvariants(db: Database.Database): void {
  const nodes = db.prepare("SELECT id, parent_id, type FROM plan_nodes").all() as {
    id: number
    parent_id: number | null
    type: string
  }[]
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const loopsAround = (id: number): number[] => {
    const loops: number[] = []
    for (let p = byId.get(id)?.parent_id ?? null; p !== null; p = byId.get(p)?.parent_id ?? null) {
      const parent = byId.get(p)
      if (!parent) break
      if (parent.type === "for-each") loops.unshift(parent.id)
    }
    return loops
  }
  const rows = states(db)
  for (const node of nodes) {
    const loops = loopsAround(node.id)
    const mine = rows.filter((r) => r.node_id === node.id)
    if (loops.length === 0) {
      expect(
        mine.map((r) => r.path),
        `node ${node.id} outside loops`,
      ).toEqual([""])
      continue
    }
    for (const row of mine) {
      const segments = row.path.split("/").map((s) => s.split(":").map(Number))
      expect(
        segments.map(([container]) => container),
        `node ${node.id} at "${row.path}"`,
      ).toEqual(loops)
      segments.forEach(([container, index], depth) => {
        const loopPath = segments
          .slice(0, depth)
          .map(([c, i]) => `${c}:${i}`)
          .join("/")
        const loopRow = rows.find((r) => r.node_id === container && r.path === loopPath)
        const length = (JSON.parse(loopRow?.content ?? "{}") as { length?: number }).length ?? 0
        expect(index, `node ${node.id} at "${row.path}" is within its loop's length`).toBeLessThan(length)
      })
    }
  }
  for (const row of rows) {
    if (byId.get(row.node_id)?.type !== "for-each") continue
    expect(Object.keys(JSON.parse(row.content ?? "{}")), `loop ${row.node_id} keeps only its length`).toEqual([
      "length",
    ])
  }
}

describe("migration 033: per-iteration state", () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  })
  afterEach(() => {
    warn.mockRestore()
  })

  const warnings = (): string[] => warn.mock.calls.map((call: unknown[]) => String(call[0]))

  it("moves a root node's state to '' and drops the state columns", () => {
    const db = at32()
    insert(db, {
      id: 1,
      content: "Брат запирает сестру.",
      summary: "кратко",
      status: "MANUAL",
      in_review: 1,
      review_base_content: "было",
      ai_improve_instruction: "короче",
    })

    migration033(db)

    expect(state(db, 1)).toMatchObject({
      content: "Брат запирает сестру.",
      summary: "кратко",
      status: "MANUAL",
      word_count: 3,
      in_review: 1,
      review_base_content: "было",
      ai_improve_instruction: "короче",
    })
    const columns = (db.pragma("table_info(plan_nodes)") as { name: string }[]).map((c) => c.name)
    for (const gone of ["content", "summary", "status", "word_count", "in_review", "ai_sync_info"]) {
      expect(columns).not.toContain(gone)
    }
    checkStateInvariants(db)
  })

  it("takes the mounted iteration from the rows and the others from the snapshots", () => {
    const db = at32()
    insert(db, {
      id: 1,
      type: "for-each",
      status: "GENERATED",
      content: loopContent({
        length: 3,
        currentIndex: 1,
        overrides: [
          { 2: entry("snapshot 0") },
          // A stale snapshot of the mounted page: the rows were written since.
          { 2: entry("stale snapshot 1", "OUTDATED") },
          { 2: entry("snapshot 2", "ERROR") },
        ],
      }),
    })
    insert(db, { id: 2, parent_id: 1, title: "Профиль", content: "live 1", status: "GENERATED" })

    migration033(db)

    expect(state(db, 2, "1:0")).toMatchObject({ content: "snapshot 0", status: "GENERATED" })
    expect(state(db, 2, "1:1")).toMatchObject({ content: "live 1", status: "GENERATED" })
    expect(state(db, 2, "1:2")).toMatchObject({ content: "snapshot 2", status: "ERROR" })
    expect(JSON.parse(state(db, 1)?.content ?? "")).toEqual({ length: 3 })
    checkStateInvariants(db)
  })

  it("keeps a live row that is staler than its snapshot — the rows are what was read", () => {
    const db = at32()
    insert(db, {
      id: 1,
      type: "for-each",
      content: loopContent({ length: 1, currentIndex: 0, overrides: [{ 2: entry("newer snapshot") }] }),
    })
    insert(db, { id: 2, parent_id: 1, content: "live", status: "OUTDATED" })

    migration033(db)

    expect(state(db, 2, "1:0")).toMatchObject({ content: "live", status: "OUTDATED" })
  })

  it("mounts missing entries and null slots as not generated, and a missing status as EMPTY", () => {
    const db = at32()
    insert(db, {
      id: 1,
      type: "for-each",
      content: loopContent({
        length: 4,
        currentIndex: 3,
        overrides: [{ 3: entry("only the other child") }, null, { 2: { content: "no status" } }],
      }),
    })
    insert(db, { id: 2, parent_id: 1 })
    insert(db, { id: 3, parent_id: 1 })

    migration033(db)

    expect(state(db, 2, "1:0")).toMatchObject({ content: null, status: "OUTDATED" })
    expect(state(db, 2, "1:1")).toMatchObject({ content: null, status: "OUTDATED" })
    expect(state(db, 2, "1:2")).toMatchObject({ content: "no status", status: "EMPTY" })
    expect(state(db, 3, "1:2")).toMatchObject({ content: null, status: "OUTDATED" })
    checkStateInvariants(db)
  })

  it("reads the rows as iteration 0 when the loop never recorded which one is mounted", () => {
    const db = at32()
    insert(db, {
      id: 1,
      type: "for-each",
      content: loopContent({ length: 2, overrides: [{ 2: entry("snapshot 0") }, { 2: entry("snapshot 1") }] }),
    })
    insert(db, { id: 2, parent_id: 1, content: "live", status: "GENERATED" })

    migration033(db)

    expect(state(db, 2, "1:0")?.content).toBe("live")
    expect(state(db, 2, "1:1")?.content).toBe("snapshot 1")
  })

  it("gives a loop over an empty list no iterations", () => {
    const db = at32()
    insert(db, { id: 1, type: "for-each", status: "GENERATED", content: loopContent({ length: 0 }) })
    insert(db, { id: 2, parent_id: 1, content: "left from an older list", status: "GENERATED" })

    migration033(db)

    expect(states(db).filter((s) => s.node_id === 2)).toEqual([])
    expect(JSON.parse(state(db, 1)?.content ?? "")).toEqual({ length: 0 })
    checkStateInvariants(db)
  })

  it("drops iterations past the length, and redoes what read a vanished output", () => {
    const db = at32()
    insert(db, {
      id: 1,
      type: "for-each",
      status: "GENERATED",
      content: loopContent({
        length: 1,
        currentIndex: 0,
        overrides: [{ 3: entry("out 0") }, { 3: entry("phantom output, 10 379 characters") }],
      }),
    })
    insert(db, { id: 2, parent_id: 1, type: "for-each-input", content: "Аня", status: "GENERATED" })
    insert(db, { id: 3, parent_id: 1, type: "for-each-output", content: "out 0", status: "GENERATED" })
    insert(db, { id: 4, type: "merge", content: "out 0\n\nphantom output", status: "GENERATED" })
    insert(db, { id: 5, type: "merge", content: "manual", status: "MANUAL" })
    edge(db, 1, 4)
    edge(db, 1, 5)

    migration033(db)

    expect(state(db, 3, "1:1")).toBeUndefined()
    expect(state(db, 1)?.status, "the loop hands on something else now").toBe("OUTDATED")
    expect(state(db, 4)?.status, "its reader held the phantom").toBe("OUTDATED")
    expect(state(db, 5)?.status, "the user's text stays theirs").toBe("MANUAL")
    expect(warnings().some((w) => w.includes("past its length"))).toBe(true)
    checkStateInvariants(db)
  })

  it("drops mounted rows past the length", () => {
    const db = at32()
    insert(db, {
      id: 1,
      type: "for-each",
      status: "GENERATED",
      content: loopContent({ length: 1, currentIndex: 2, overrides: [{ 2: entry("out 0") }] }),
    })
    insert(db, { id: 2, parent_id: 1, type: "for-each-output", content: "out 2", status: "GENERATED" })
    insert(db, { id: 3, type: "merge", status: "GENERATED" })
    edge(db, 1, 3)

    migration033(db)

    expect(states(db).filter((s) => s.node_id === 2)).toEqual([expect.objectContaining({ path: "1:0" })])
    expect(state(db, 3)?.status).toBe("OUTDATED")
    checkStateInvariants(db)
  })

  it("turns an interrupted GENERATING into OUTDATED, in rows and in snapshots", () => {
    const db = at32()
    insert(db, { id: 1, status: "GENERATING" })
    insert(db, {
      id: 2,
      type: "for-each",
      content: loopContent({ length: 2, currentIndex: 0, overrides: [null, { 3: entry("half", "GENERATING") }] }),
    })
    insert(db, { id: 3, parent_id: 2, status: "GENERATING" })

    migration033(db)

    expect(state(db, 1)?.status).toBe("OUTDATED")
    expect(state(db, 3, "2:0")?.status).toBe("OUTDATED")
    expect(state(db, 3, "2:1")?.status).toBe("OUTDATED")
  })

  it("passes a non-loop parent's path on to its children", () => {
    const db = at32()
    insert(db, { id: 1, content: "parent", status: "MANUAL" })
    insert(db, { id: 2, parent_id: 1, content: "child", status: "GENERATED" })

    migration033(db)

    expect(state(db, 2, "")?.content).toBe("child")
    checkStateInvariants(db)
  })

  it("treats a node whose parent is gone as a top-level node", () => {
    const db = at32()
    insert(db, { id: 2, parent_id: 99, content: "orphan", status: "GENERATED" })

    migration033(db)

    expect(state(db, 2, "")?.content).toBe("orphan")
    expect(warnings().some((w) => w.includes("parent 99 does not exist"))).toBe(true)
  })

  it("unpacks a nested loop from inside its outer loop's snapshots", () => {
    const db = at32()
    const inner = (length: number, scene: string, currentIndex = 0) =>
      loopContent({ length, currentIndex, overrides: [{ 3: entry(`${scene} A`) }, { 3: entry(`${scene} B`) }] })
    insert(db, {
      id: 1,
      type: "for-each",
      status: "GENERATED",
      content: loopContent({
        length: 2,
        currentIndex: 0,
        // The inner loop's content is a JSON string inside the outer snapshot.
        overrides: [null, { 2: entry(inner(2, "part 2")) }],
      }),
    })
    insert(db, { id: 2, parent_id: 1, type: "for-each", status: "GENERATED", content: inner(2, "part 1", 1) })
    insert(db, { id: 3, parent_id: 2, content: "part 1 B, live", status: "GENERATED" })

    migration033(db)

    expect(state(db, 3, "1:0/2:0")?.content).toBe("part 1 A")
    expect(state(db, 3, "1:0/2:1")?.content).toBe("part 1 B, live")
    expect(state(db, 3, "1:1/2:0")?.content).toBe("part 2 A")
    expect(state(db, 3, "1:1/2:1")?.content).toBe("part 2 B")
    expect(JSON.parse(state(db, 2, "1:1")?.content ?? "")).toEqual({ length: 2 })
    checkStateInvariants(db)
  })

  it("demotes a nested child the inner loop, in that iteration, knows to be stale", () => {
    const db = at32()
    insert(db, {
      id: 1,
      type: "for-each",
      content: loopContent({
        length: 2,
        currentIndex: 0,
        overrides: [null, { 2: entry(loopContent({ length: 1, overrides: [{ 3: entry("scene") }] }), "OUTDATED") }],
      }),
    })
    insert(db, { id: 2, parent_id: 1, type: "for-each", status: "GENERATED", content: loopContent({ length: 1 }) })
    insert(db, { id: 3, parent_id: 2, content: "live scene", status: "GENERATED" })

    migration033(db)

    expect(state(db, 3, "1:0/2:0")?.status, "its loop is GENERATED there").toBe("GENERATED")
    expect(state(db, 3, "1:1/2:0")?.status, "its loop is OUTDATED there").toBe("OUTDATED")
  })

  it("keeps a review at the top level and clears one inside a loop", () => {
    const db = at32()
    insert(db, { id: 1, content: "root", status: "MANUAL", in_review: 1, review_base_content: "old root" })
    insert(db, { id: 2, type: "for-each", content: loopContent({ length: 2, currentIndex: 1 }) })
    insert(db, {
      id: 3,
      parent_id: 2,
      content: "profile 1",
      status: "MANUAL",
      in_review: 1,
      review_base_content: "profile of another element",
      ai_improve_instruction: "короче",
    })

    migration033(db)

    expect(state(db, 1)).toMatchObject({ in_review: 1, review_base_content: "old root" })
    expect(state(db, 3, "2:1")).toMatchObject({
      content: "profile 1",
      in_review: 0,
      review_base_content: null,
      ai_improve_instruction: null,
    })
    expect(warnings().some((w) => w.includes("review was dropped"))).toBe(true)
  })

  it("gives a loop with unreadable content no iterations, and says so", () => {
    const db = at32()
    insert(db, { id: 1, type: "for-each", status: "GENERATED", content: "{not json" })
    insert(db, { id: 2, parent_id: 1, content: "live", status: "GENERATED" })

    migration033(db)

    expect(states(db).filter((s) => s.node_id === 2)).toEqual([])
    expect(JSON.parse(state(db, 1)?.content ?? "")).toEqual({ length: 0 })
    expect(warnings().some((w) => w.includes("not JSON"))).toBe(true)
  })

  it("recounts words of text outputs from the content", () => {
    const db = at32()
    insert(db, { id: 1, content: "три слова тут", status: "GENERATED", word_count: 0 })

    migration033(db)

    expect(state(db, 1)?.word_count).toBe(3)
  })

  it("warns about an edge that leaves a loop past its output", () => {
    const db = at32()
    insert(db, { id: 1, type: "for-each", content: loopContent({ length: 1 }) })
    insert(db, { id: 2, parent_id: 1, title: "Внутри" })
    insert(db, { id: 3, title: "Снаружи" })
    edge(db, 2, 3)

    migration033(db)

    expect(warnings().some((w) => w.includes("«Внутри»") && w.includes("leaves a loop"))).toBe(true)
  })

  it("does nothing the second time", () => {
    const db = at32()
    insert(db, { id: 1, content: "x", status: "MANUAL" })
    migration033(db)
    db.prepare("UPDATE plan_node_states SET content = 'edited since'").run()

    migration033(db)

    expect(state(db, 1)?.content).toBe("edited since")
  })

  it("lets a node's state go with it", () => {
    const db = at32()
    insert(db, { id: 1, content: "x", status: "MANUAL" })
    migration033(db)
    db.pragma("foreign_keys = ON")

    db.prepare("DELETE FROM plan_nodes WHERE id = 1").run()

    expect(states(db)).toEqual([])
  })

  it("runs as part of the chain to the current version", () => {
    const db = at32()
    insert(db, { id: 1, content: "x", status: "MANUAL" })

    migrateDatabase(db)

    expect(db.pragma("user_version", { simple: true })).toBeGreaterThanOrEqual(33)
    expect(state(db, 1)?.content).toBe("x")
  })
})

/** A deterministic pseudo-random generator: the same seed builds the same projects. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe("migration 033 against the old way of reading iterations", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const STATUSES = ["EMPTY", "GENERATING", "GENERATED", "MANUAL", "OUTDATED", "ERROR"]

  for (let seed = 1; seed <= 40; seed++) {
    it(`reads every iteration as the old model did (seed ${seed})`, () => {
      const random = mulberry32(seed)
      const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)]
      const text = () => pick(["", "Аня", "Боря идёт домой", "длинный ответ модели", "x"])

      const db = at32()
      const root = { content: text() || null, status: pick(STATUSES) }
      insert(db, { id: 1, ...root })
      const children = [
        { id: 3, type: "for-each-input" },
        { id: 4, type: "text" },
        { id: 5, type: "for-each-output" },
      ]
      const length = Math.floor(random() * 4)
      const currentIndex = random() < 0.2 ? undefined : Math.floor(random() * (length + 1))
      const overrides: unknown[] = Array.from({ length: length + (random() < 0.3 ? 1 : 0) }, () => {
        if (random() < 0.15) return null
        const slot: Record<string, unknown> = {}
        for (const child of children) {
          if (random() < 0.15) continue
          slot[child.id] =
            random() < 0.1 ? { content: text() } : entry(text() || null, pick(STATUSES), { summary: text() })
        }
        return slot
      })
      insert(db, {
        id: 2,
        type: "for-each",
        status: pick(STATUSES),
        content: loopContent({ length, currentIndex, overrides }),
      })
      const live = new Map<number, { content: string | null; status: string }>()
      for (const child of children) {
        const row = { content: text() || null, status: pick(STATUSES) }
        live.set(child.id, row)
        insert(db, { id: child.id, parent_id: 2, type: child.type, ...row })
      }

      migration033(db)
      checkStateInvariants(db)

      // The old reading, frozen: the mounted page from the rows, the others
      // from the snapshots as `applyForEachNodeIterationToChildren` mounted them.
      const mounted = currentIndex ?? 0
      const settled = (status: string) => (status === "GENERATING" ? "OUTDATED" : status)
      for (let i = 0; i < length; i++) {
        for (const child of children) {
          let expected: { content: string | null; status: string }
          if (i === mounted) {
            expected = live.get(child.id)!
          } else {
            const slot = overrides[i] as Record<string, { content?: string | null; status?: string }> | null
            const found = slot?.[child.id]
            expected = found
              ? { content: found.content ?? null, status: found.status ?? "EMPTY" }
              : { content: null, status: "OUTDATED" }
          }
          const actual = state(db, child.id, `2:${i}`)
          expect(actual?.content ?? null, `child ${child.id}, iteration ${i}: content`).toBe(expected.content)
          expect(actual?.status, `child ${child.id}, iteration ${i}: status`).toBe(settled(expected.status))
        }
      }
      expect(state(db, 1)?.content ?? null, "the root node's content").toBe(root.content)
      expect(state(db, 1)?.status, "the root node's status").toBe(settled(root.status))
    })
  }
})
