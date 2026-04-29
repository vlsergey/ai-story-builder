// main.ts / main.js (или index.ts)

import path from "node:path"
import type { ProjectTemplate } from "@shared/project-template"
import { app } from "electron"
import fs from "fs-extra"

const SYSTEM_TEMPLATES = app.isPackaged
  ? path.join(process.resourcesPath, "templates")
  : path.join(__dirname, "resources", "templates")
const USER_TEMPLATES = path.join(app.getPath("userData"), "templates")

type TemplateInfo = {
  filePath: string
  type: "user" | "system"
} & Pick<ProjectTemplate, "label" | "description">

export const getTemplateFolders = () => ({
  system: SYSTEM_TEMPLATES,
  user: USER_TEMPLATES,
})

export async function getTemplate(templatePath: string): Promise<ProjectTemplate> {
  return (await fs.readJson(templatePath)) as ProjectTemplate
}

export async function findTemplates(): Promise<TemplateInfo[]> {
  const systemTemplatesPromise = findTemplatesImpl(SYSTEM_TEMPLATES, "system")
  const userTemplatesPromise = findTemplatesImpl(USER_TEMPLATES, "user")

  const allTemplates = [...(await systemTemplatesPromise), ...(await userTemplatesPromise)]
  return allTemplates.sort((a, b) => a.label.localeCompare(b.label))
}

async function findTemplatesImpl(dir: string, type: "user" | "system"): Promise<TemplateInfo[]> {
  console.debug("[findTemplatesImpl]", "Looking for templates in folder", dir, type)
  if (!(await fs.pathExists(dir))) {
    return []
  }

  const files = await fs.readdir(dir)
  const result: TemplateInfo[] = []
  for (const filename of files) {
    if (!filename.endsWith(".json")) continue
    const filePath = path.join(dir, filename)

    try {
      const data = (await fs.readJson(filePath)) as ProjectTemplate
      const { label, description } = data
      result.push({
        filePath,
        type,
        label,
        description,
      })
    } catch (e) {
      console.error(`Unable to read template info from '${filePath}':`, e)
    }
  }
  return result
}
