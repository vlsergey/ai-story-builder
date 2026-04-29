import { readAppSettings, writeAppSettings } from "../db/state.js"
import { makeErrorWithStatus } from "../lib/make-errors.js"

function updateRecent(dbPath: string): void {
  const s = readAppSettings()
  s.recent = s.recent || []
  s.recent = [dbPath].concat(s.recent.filter((x) => x !== dbPath)).slice(0, 10)
  writeAppSettings(s)
}

export function getRecentProjects(): string[] {
  const s = readAppSettings()
  return s.recent || []
}

export function deleteRecentProject(p: string): { ok: boolean } {
  if (!p) throw makeErrorWithStatus("path required", 400)
  const s = readAppSettings()
  s.recent = (s.recent || []).filter((x) => x !== p)
  writeAppSettings(s)
  return { ok: true }
}

export { updateRecent }
