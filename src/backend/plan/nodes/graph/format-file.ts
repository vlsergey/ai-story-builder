import path from "node:path"
import Handlebars from "handlebars"
import { getCurrentDbPath } from "../../../db/state.js"
import { SettingsRepository } from "../../../settings/settings-repository.js"

/** What a page's file name mask can name. */
export interface FileNameParts {
  /** The project file's name, without its extension. */
  projectFile: string
  /** The project's title, as the project settings hold it. */
  projectName: string
  /** The node's title. */
  title: string
}

/** The mask a page is saved under unless its settings say otherwise. */
export const DEFAULT_FILE_NAME = "{{projectFile}}.html"

/** What a file name cannot hold on Windows, the strictest of the systems the app runs on. */
const UNSAFE = /[\u0000-\u001f<>:"/\\|?*]/g

/**
 * The file name `mask` gives: a mustache template over `parts`, with what a
 * file name cannot hold replaced by `_`, and the trailing dots and spaces
 * Windows drops cut off. Empty when the mask gives nothing. Throws on a mask
 * that does not parse.
 */
export function formatFileName(mask: string, parts: FileNameParts): string {
  const name = Handlebars.compile(mask, { noEscape: true })(parts)
  return name
    .replace(UNSAFE, "_")
    .trim()
    .replace(/[. ]+$/, "")
}

/**
 * Where a page saved under `mask` goes: the project's folder — null for a
 * project that has no file — and the name the mask gives.
 */
export function savedPageTarget(mask: string, title: string): { folder: string | null; name: string } {
  const projectPath = getCurrentDbPath()
  const hasFile = !!projectPath && projectPath !== ":memory:"
  const name = formatFileName(mask, {
    projectFile: hasFile ? path.basename(projectPath, path.extname(projectPath)) : "",
    projectName: SettingsRepository.getProjectTitle() ?? "",
    title,
  })
  return { folder: hasFile ? path.dirname(projectPath) : null, name }
}

/** The path of a page saved under `mask`; null when there is no folder or no name. */
export function savedPagePath(mask: string, title: string): string | null {
  const { folder, name } = savedPageTarget(mask, title)
  return folder && name ? path.join(folder, name) : null
}
