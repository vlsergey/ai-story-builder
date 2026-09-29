import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"
import {
  atOrBelowSql,
  childPath,
  formatPath,
  isAtOrBelow,
  lastSegment,
  parentPath,
  parsePath,
  pathDepth,
  ROOT_PATH,
  truncatePath,
} from "../../../shared/plan-node-path.js"

/** A small deterministic generator: the same corpus on every run. */
function* paths(seed: number, count: number): Generator<string> {
  let state = seed
  const next = (n: number) => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state % n
  }
  const containers = [2, 27, 270, 4]
  const keys = ["0", "1", "2", "10", "20", "a3f9c1", "a3f9c10"]
  for (let i = 0; i < count; i++) {
    const depth = next(4)
    const segments = Array.from({ length: depth }, () => ({
      containerId: containers[next(containers.length)],
      key: keys[next(keys.length)],
    }))
    yield formatPath(segments)
  }
}

describe("node paths", () => {
  it("parse and format round-trip", () => {
    for (const path of paths(1, 300)) expect(formatPath(parsePath(path))).toBe(path)
  })

  it("childPath and parentPath undo each other", () => {
    for (const path of paths(2, 300)) {
      expect(parentPath(childPath(path, 27, "3"))).toBe(path)
      expect(pathDepth(childPath(path, 27, 3))).toBe(pathDepth(path) + 1)
    }
  })

  it("truncates to the path a shallower node is read at", () => {
    expect(truncatePath("27:2/40:1", 0)).toBe(ROOT_PATH)
    expect(truncatePath("27:2/40:1", 1)).toBe("27:2")
    expect(truncatePath("27:2/40:1", 2)).toBe("27:2/40:1")
    expect(lastSegment("27:2/40:1")).toEqual({ containerId: 40, key: "1" })
    expect(lastSegment(ROOT_PATH)).toBeNull()
  })

  it("does not take iteration 20 for a child of iteration 2", () => {
    expect(isAtOrBelow("27:20", "27:2")).toBe(false)
    expect(isAtOrBelow("27:2/40:0", "27:2")).toBe(true)
    expect(isAtOrBelow("27:2", "27:2")).toBe(true)
    expect(isAtOrBelow("27:2", ROOT_PATH)).toBe(true)
  })

  it("rejects a malformed path", () => {
    expect(() => parsePath("27")).toThrow(/Malformed/)
    expect(() => parsePath("x:1")).toThrow(/Malformed/)
  })

  it("is a partial order: reflexive, antisymmetric, transitive", () => {
    const corpus = [...new Set(paths(3, 60))]
    for (const a of corpus) {
      expect(isAtOrBelow(a, a)).toBe(true)
      for (const b of corpus) {
        if (a !== b && isAtOrBelow(a, b)) expect(isAtOrBelow(b, a)).toBe(false)
        for (const c of corpus) if (isAtOrBelow(a, b) && isAtOrBelow(b, c)) expect(isAtOrBelow(a, c)).toBe(true)
      }
    }
  })

  it("the SQL predicate agrees with isAtOrBelow", () => {
    const db = new Database(":memory:")
    db.exec("CREATE TABLE t (path TEXT NOT NULL)")
    const corpus = [...new Set(paths(4, 400))]
    const insert = db.prepare("INSERT INTO t (path) VALUES (?)")
    for (const path of corpus) insert.run(path)
    for (const ancestor of corpus.slice(0, 80)) {
      const { sql, params } = atOrBelowSql("path", ancestor)
      const fromSql = (db.prepare(`SELECT path FROM t WHERE ${sql}`).all(...params) as { path: string }[])
        .map((r) => r.path)
        .sort()
      expect(fromSql, `at or below "${ancestor}"`).toEqual(corpus.filter((p) => isAtOrBelow(p, ancestor)).sort())
    }
    db.close()
  })
})
