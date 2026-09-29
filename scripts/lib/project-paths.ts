import fs from "node:fs"
import path from "node:path"
import Database from "better-sqlite3"
import { openProjectDatabase } from "../../src/backend/db/index.js"
import { assertReadableVersion, CURRENT_VERSION } from "../../src/backend/db/migrations.js"
import { setCurrentDbPath } from "../../src/backend/db/state.js"
import { getProjectsFolder } from "../../src/backend/projects/project-folder.js"

/**
 * Resolve a `--project` CLI argument to an absolute `.sqlite` path.
 *
 * Accepts:
 *   - a full path that exists on disk;
 *   - a bare project name (the script appends `.sqlite` if missing) — looked
 *     up in the same projects directory the Electron app uses (cross-platform
 *     via `getProjectsFolder()` → `getDataDir()`, which picks the right
 *     userData location on Windows / macOS / Linux).
 *
 * Throws with both attempted paths in the error message if nothing matched.
 */
export function resolveProjectPath(spec: string): string {
  if (fs.existsSync(spec) && fs.statSync(spec).isFile()) return spec
  const dir = getProjectsFolder()
  const candidates = [path.join(dir, spec), path.join(dir, `${spec}.sqlite`)]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error(`Project not found: tried ${spec} and ${candidates.join(", ")}`)
}

/**
 * Brings a project file to the current schema, as the app does when it opens
 * one: a file from an older version is backed up and migrated, one from a
 * newer version is refused. A current file is left alone — no backup for a
 * script that only reads. Returns the resolved path.
 */
export function migrateProject(spec: string): string {
  const dbPath = resolveProjectPath(spec)
  const probe = new Database(dbPath, { readonly: true, fileMustExist: true })
  let version: number
  try {
    assertReadableVersion(probe)
    version = probe.pragma("user_version", { simple: true }) as number
  } finally {
    probe.close()
  }
  if (version < CURRENT_VERSION) openProjectDatabase(dbPath).close()
  return dbPath
}

/** Migrates the project if needed and makes it the database the repositories use. */
export function openProject(spec: string): string {
  const dbPath = migrateProject(spec)
  setCurrentDbPath(dbPath)
  return dbPath
}

/** Re-exported so callers don't need to know the layered backend path. */
export { getProjectsFolder }
