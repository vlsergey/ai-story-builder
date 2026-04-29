import fs from "node:fs"
import path from "node:path"
import { getDataDir } from "../db/state.js"
import { sanitizeProjectName } from "./sanitize-project-name.js"

export function getProjectsFolder(): string {
  return path.join(getDataDir(), "projects")
}

export function hasProjectWithName(title: string): boolean {
  const safeName = sanitizeProjectName(title)
  const projectsDir = getProjectsFolder()
  const dbPath = path.join(projectsDir, `${safeName}.sqlite`)
  const result = fs.existsSync(dbPath)
  console.debug("[hasProjectWithName]", title, result)
  return result
}

export function listProjectFiles(): { dir: string; files: string[] } {
  const projectsDir = getProjectsFolder()
  if (!fs.existsSync(projectsDir)) return { dir: projectsDir, files: [] }
  const files = fs
    .readdirSync(projectsDir)
    .filter((f) => f.endsWith(".sqlite") || f.endsWith(".db"))
    .map((f) => path.join(projectsDir, f))
  return { dir: projectsDir, files }
}
