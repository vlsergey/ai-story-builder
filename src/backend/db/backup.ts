import fs from "node:fs"
import path from "node:path"

const MAX_BACKUPS = 7

/**
 * Creates a backup copy of a SQLite database file before opening/migrating it.
 * Backups are stored in a `backups/` subdirectory next to the database file.
 * Keeps at most MAX_BACKUPS (7) backups per project, pruning the oldest ones.
 *
 * Naming: `{basename}.{YYYYMMDDTHHMMSS}.bak`
 * Example: `MyProject.20240115T103045.bak`
 *
 * No-op if the database file does not exist yet (new project creation).
 */
export function createBackup(dbPath: string): void {
  if (!fs.existsSync(dbPath)) return

  const backupDir = path.join(path.dirname(dbPath), "backups")
  fs.mkdirSync(backupDir, { recursive: true })

  const basename = path.basename(dbPath, path.extname(dbPath))
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "T").slice(0, 15) // "YYYYMMDDTHHmmss"
  const backupName = `${basename}.${timestamp}.bak`
  const backupPath = path.join(backupDir, backupName)

  fs.copyFileSync(dbPath, backupPath)
  console.log(`[db] backup created: ${backupPath}`)

  pruneBackups(backupDir, basename)
}

/**
 * Removes oldest backups for the given project, keeping at most MAX_BACKUPS.
 */
function pruneBackups(backupDir: string, basename: string): void {
  let files: string[]
  try {
    files = fs.readdirSync(backupDir)
  } catch {
    return
  }

  const backups = files.filter((f) => f.startsWith(`${basename}.`) && f.endsWith(".bak")).sort() // lexicographic order works because timestamps are in ISO format

  const toDelete = backups.slice(0, Math.max(0, backups.length - MAX_BACKUPS))
  for (const f of toDelete) {
    try {
      fs.unlinkSync(path.join(backupDir, f))
      console.log(`[db] backup pruned: ${f}`)
    } catch (e) {
      console.warn(`[db] failed to prune backup ${f}:`, (e as Error).message)
    }
  }
}
