import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CURRENT_VERSION } from "../db/index.js"
import { tearDownTestDb } from "../db/test-db-utils.js"
import { createProject } from "./create-project.js"

// The projects folder and the recent-projects list live in the user's app
// data; a test must never touch either.
const folder = vi.hoisted(() => ({ path: "" }))
vi.mock("./project-folder.js", () => ({ getProjectsFolder: () => folder.path }))
vi.mock("./recent-projects.js", () => ({ updateRecent: () => {} }))

describe("creating a project whose file already exists", () => {
  beforeEach(() => {
    folder.path = fs.mkdtempSync(path.join(os.tmpdir(), "create-project-"))
  })
  afterEach(() => {
    tearDownTestDb()
    fs.rmSync(folder.path, { recursive: true, force: true })
  })

  const existing = (version: number) => {
    const file = path.join(folder.path, "Balcony.sqlite")
    const db = new Database(file)
    db.pragma(`user_version = ${version}`)
    db.close()
    return file
  }

  it("refuses it when a newer version of the app saved it", () => {
    existing(CURRENT_VERSION + 1)

    expect(() => createProject({ title: "Balcony" } as never)).toThrow(/newer version/)
  })

  it("brings it up to date when an older version saved it", () => {
    const file = existing(0)

    const result = createProject({ title: "Balcony" } as never)

    expect(result.reused).toBe(true)
    tearDownTestDb()
    const db = new Database(file)
    expect(db.pragma("user_version", { simple: true })).toBe(CURRENT_VERSION)
    db.close()
  })
})
