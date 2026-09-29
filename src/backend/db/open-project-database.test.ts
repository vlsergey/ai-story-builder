import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CURRENT_VERSION, openProjectDatabase } from "./index.js"

describe("opening a project", () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "open-project-"))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("saved by a newer version of the app is refused, and the file is left as it is", () => {
    const file = path.join(dir, "Балкон.sqlite")
    const newer = new Database(file)
    newer.pragma(`user_version = ${CURRENT_VERSION + 1}`)
    newer.close()

    expect(() => openProjectDatabase(file)).toThrow(/newer version/)

    // Reopening also proves the refused handle was closed: Windows keeps an open file locked.
    const after = new Database(file)
    expect(after.pragma("user_version", { simple: true })).toBe(CURRENT_VERSION + 1)
    after.close()
  })

  it("saved by this version opens as usual", () => {
    const file = path.join(dir, "Балкон.sqlite")
    openProjectDatabase(file).close()

    const db = openProjectDatabase(file)
    expect(db.pragma("user_version", { simple: true })).toBe(CURRENT_VERSION)
    db.close()
  })
})
