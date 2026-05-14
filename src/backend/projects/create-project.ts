import fs from "node:fs"
import path from "node:path"
import type { ProjectTemplate } from "@shared/project-template.js"
import type { ProjectCreateOptions } from "../../shared/project-create-options.js"
import { openProjectDatabase } from "../db/index.js"
import { setCurrentDbPath } from "../db/state.js"
import { makeErrorWithStatus } from "../lib/make-errors.js"
import { SettingsRepository } from "../settings/settings-repository.js"
import { applyProjectTemplate } from "./apply-project-template.js"
import { getProjectsFolder } from "./project-folder.js"
import { getProjectInitialData } from "./project-state.js"
import { updateRecent } from "./recent-projects.js"
import { sanitizeProjectName } from "./sanitize-project-name.js"

export function createProject({ title, templateFilePath, templateData }: ProjectCreateOptions): {
  path: string
  layout: unknown
  projectTitle: string | null
  reused?: boolean
} {
  const safeName = sanitizeProjectName(title)
  const projectsDir = getProjectsFolder()
  fs.mkdirSync(projectsDir, { recursive: true })
  const dbPath = path.join(projectsDir, `${safeName}.sqlite`)

  if (fs.existsSync(dbPath)) {
    setCurrentDbPath(dbPath)
    updateRecent(dbPath)
    return { path: dbPath, reused: true, ...getProjectInitialData(dbPath) }
  }

  try {
    openProjectDatabase(dbPath)
    setCurrentDbPath(dbPath)

    if (templateFilePath) {
      importProjectFromTemplate(templateFilePath, templateData)
    }

    SettingsRepository.setProjectTitle(title)

    updateRecent(dbPath)

    return { path: dbPath, layout: null, projectTitle: title }
  } catch (e) {
    throw makeErrorWithStatus(String(e), 500)
  }
}

function importProjectFromTemplate(templateFilePath: string, templateData: Record<string, any>): void {
  if (!fs.existsSync(templateFilePath)) {
    throw makeErrorWithStatus(`Template file not found: ${templateFilePath}`, 404)
  }
  const projectTemplate = JSON.parse(fs.readFileSync(templateFilePath, "utf8")) as ProjectTemplate
  applyProjectTemplate(projectTemplate, templateData)
  SettingsRepository.setAppliedTemplateFile(path.basename(templateFilePath))
}
