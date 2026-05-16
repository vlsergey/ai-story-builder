import fs from "node:fs"
import path from "node:path"
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

/** Re-exported so callers don't need to know the layered backend path. */
export { getProjectsFolder }
