import path from "node:path"
import { fileURLToPath } from "node:url"
import type { ProjectTemplate } from "@shared/project-template"
import electron from "electron"
import fs from "fs-extra"
import { getDataDir } from "../db/state.js"

// The package is ESM (`"type": "module"`); Node won't define __dirname for us
// and electron's named exports aren't available from a plain `tsx` run either.
// Resolve both via lazy fallbacks so this module can be imported from scripts.
const __dirname = path.dirname(fileURLToPath(import.meta.url))

function systemTemplatesDir(): string {
  // In packaged Electron the templates live next to the resources bundle.
  // Outside Electron (tsx scripts, tests) fall back to whichever path exists.
  try {
    const app = (electron as unknown as { app?: { isPackaged?: boolean } }).app
    if (app?.isPackaged) {
      return path.join((process as { resourcesPath?: string }).resourcesPath ?? "", "templates")
    }
  } catch {
    // No Electron context — fall through to dev location.
  }
  // dev under tsup-bundled `dist/backend/`: templates at `./resources/templates`.
  // dev under raw tsx (scripts/, tests): templates at the source-tree location
  // `src/backend/resources/resources/templates/`, which is two levels up from
  // this file's directory.
  const candidates = [
    path.join(__dirname, "resources", "templates"),
    path.join(__dirname, "..", "resources", "resources", "templates"),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return candidates[0]
}

function userTemplatesDir(): string {
  return path.join(getDataDir(), "templates")
}

type TemplateInfo = {
  filePath: string
  type: "user" | "system"
} & Pick<ProjectTemplate, "label" | "description">

export const getTemplateFolders = () => ({
  system: systemTemplatesDir(),
  user: userTemplatesDir(),
})

export async function getTemplate(templatePath: string): Promise<ProjectTemplate> {
  return (await fs.readJson(templatePath)) as ProjectTemplate
}

export async function findTemplates(): Promise<TemplateInfo[]> {
  const systemTemplatesPromise = findTemplatesImpl(systemTemplatesDir(), "system")
  const userTemplatesPromise = findTemplatesImpl(userTemplatesDir(), "user")

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
