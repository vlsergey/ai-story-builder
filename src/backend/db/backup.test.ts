import fs from "fs"
import os from "os"
import path from "path"
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createBackup } from "./backup.js"

describe("createBackup", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "backup_test_"))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("does nothing if the database file does not exist", () => {
    const dbPath = path.join(tmpDir, "nonexistent.sqlite")
    expect(() => createBackup(dbPath)).not.toThrow()
    const backupDir = path.join(tmpDir, "backups")
    expect(fs.existsSync(backupDir)).toBe(false)
  })

  it("creates a backup copy in a backups/ subdirectory", () => {
    const dbPath = path.join(tmpDir, "project.sqlite")
    fs.writeFileSync(dbPath, "fake-sqlite-content")

    createBackup(dbPath)

    const backupDir = path.join(tmpDir, "backups")
    expect(fs.existsSync(backupDir)).toBe(true)
    const files = fs.readdirSync(backupDir)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^project\.\d{8}T\d{6}\.bak$/)
  })

  it("backup file contains the same content as the original", () => {
    const dbPath = path.join(tmpDir, "project.sqlite")
    const content = "my-database-bytes"
    fs.writeFileSync(dbPath, content)

    createBackup(dbPath)

    const backupDir = path.join(tmpDir, "backups")
    const [backupFile] = fs.readdirSync(backupDir)
    const backupContent = fs.readFileSync(path.join(backupDir, backupFile), "utf8")
    expect(backupContent).toBe(content)
  })

  it("prunes old backups, keeping only the 7 most recent", () => {
    const dbPath = path.join(tmpDir, "project.sqlite")
    const backupDir = path.join(tmpDir, "backups")
    fs.mkdirSync(backupDir)

    // Pre-create 7 old backups with earlier timestamps
    for (let i = 1; i <= 7; i++) {
      const ts = `2024010${i}T120000`
      fs.writeFileSync(path.join(backupDir, `project.${ts}.bak`), `old-${i}`)
    }

    fs.writeFileSync(dbPath, "new-content")
    createBackup(dbPath) // adds an 8th backup

    const files = fs.readdirSync(backupDir).sort()
    expect(files).toHaveLength(7)
    // The oldest backup (20240101) should have been pruned
    expect(files.some((f) => f.includes("20240101"))).toBe(false)
    // The newest one (the one we just created) must still be there
    expect(files.some((f) => f.includes("2025") || f.includes("2026"))).toBe(true)
  })

  it("creates multiple backups on repeated calls, each with a unique timestamp", async () => {
    const dbPath = path.join(tmpDir, "project.sqlite")
    fs.writeFileSync(dbPath, "v1")
    createBackup(dbPath)

    // Ensure at least 1 second gap so timestamps differ
    await new Promise((r) => setTimeout(r, 1100))

    fs.writeFileSync(dbPath, "v2")
    createBackup(dbPath)

    const backupDir = path.join(tmpDir, "backups")
    const files = fs.readdirSync(backupDir)
    expect(files).toHaveLength(2)
  })
})
