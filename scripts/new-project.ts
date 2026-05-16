#!/usr/bin/env tsx
/**
 * Create a new project file from a template, with AI settings copied from
 * an existing project. Validates wizard fields against the template's
 * schema before creating anything.
 *
 *   npx tsx scripts/new-project.ts \
 *     --name "Гонец" \
 *     --template fiction-arc.ru.json \
 *     --copy-settings-from "Письмо" \
 *     --wizard-file ./synopses/gonets.json \
 *     --wizard "chunksCount=8"
 *
 * --wizard-file is a JSON object of field-name → value. --wizard k=v
 * (repeatable) layers on top — useful for tweaking a single field
 * without editing the JSON. CLI key-value wins on collision.
 *
 * Project file goes to %APPDATA%/ai-story-builder/projects/<name>.sqlite
 * (or the OS equivalent). Refuses to overwrite an existing file — pick a
 * different name if you want a fresh run on the same synopsis.
 */
import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { parseArgs } from "node:util"
import { setCurrentDbPath } from "../src/backend/db/state.js"
import { createProject } from "../src/backend/projects/create-project.js"
import { applyProjectSettings, getProjectSettings } from "../src/backend/projects/project-settings.js"
import { sanitizeProjectName } from "../src/backend/projects/sanitize-project-name.js"
import type { ProjectTemplate, WizardField } from "../src/shared/project-template.js"
import { buildFormSchema } from "../src/shared/project-template-form.js"
import { getProjectsFolder, resolveProjectPath } from "./lib/project-paths.js"

interface CliArgs {
  name: string
  template: string
  copySettingsFrom?: string
  wizardFile?: string
  wizardKv: Record<string, string>
}

function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      name: { type: "string" },
      template: { type: "string" },
      "copy-settings-from": { type: "string" },
      "wizard-file": { type: "string" },
      wizard: { type: "string", multiple: true },
    },
  })
  if (!values.name || !values.template) {
    process.stderr.write(
      "usage: tsx scripts/new-project.ts " +
        "--name <project-name> " +
        "--template <template-file> " +
        "[--copy-settings-from <project-name-or-path>] " +
        "[--wizard-file <kv.json>] " +
        "[--wizard key=value]…\n",
    )
    process.exit(2)
  }
  const wizardKv: Record<string, string> = {}
  for (const item of values.wizard ?? []) {
    const eq = item.indexOf("=")
    if (eq <= 0) {
      process.stderr.write(`--wizard must be key=value, got: ${item}\n`)
      process.exit(2)
    }
    wizardKv[item.slice(0, eq)] = item.slice(eq + 1)
  }
  return {
    name: values.name,
    template: values.template,
    copySettingsFrom: values["copy-settings-from"],
    wizardFile: values["wizard-file"],
    wizardKv,
  }
}

function resolveTemplatePath(spec: string): string {
  if (fs.existsSync(spec) && fs.statSync(spec).isFile()) return spec
  const repoTemplates = path.join(process.cwd(), "src", "backend", "resources", "resources", "templates", spec)
  if (fs.existsSync(repoTemplates)) return repoTemplates
  const userTemplates = path.join(getProjectsFolder(), "..", "templates", spec)
  if (fs.existsSync(userTemplates)) return userTemplates
  throw new Error(`Template not found: ${spec}`)
}

/**
 * Coerce raw string-or-anything values from `--wizard k=v` / wizard-file into
 * the types the template's fields declare. The Zod schema below will reject
 * anything we miss here.
 */
function coerceFieldValue(field: WizardField, raw: unknown): unknown {
  if (raw == null) return raw
  switch (field.type) {
    case "integer": {
      const n = typeof raw === "number" ? raw : Number(String(raw))
      if (!Number.isInteger(n)) throw new Error(`Field '${field.name}' must be an integer (got ${JSON.stringify(raw)})`)
      return n
    }
    default:
      return String(raw)
  }
}

function buildTemplateData(template: ProjectTemplate, fileVals: Record<string, unknown>, kv: Record<string, string>) {
  const fields = (template.wizardPages ?? []).flatMap((p) => p.fields)
  const declared = new Set(fields.map((f) => f.name))
  const merged: Record<string, unknown> = { ...fileVals, ...kv }

  // Unknown keys → reject. Better to fail loudly than to silently drop a
  // field the user thought they were setting.
  for (const k of Object.keys(merged)) {
    if (!declared.has(k)) {
      throw new Error(
        `Unknown wizard field '${k}'. Template defines: ${[...declared].join(", ") || "(no wizard fields)"}`,
      )
    }
  }

  // Coerce + fill defaults.
  const coerced: Record<string, unknown> = {}
  const missing: string[] = []
  for (const field of fields) {
    if (merged[field.name] !== undefined) {
      coerced[field.name] = coerceFieldValue(field, merged[field.name])
      continue
    }
    if ("defaultValue" in field && field.defaultValue !== undefined) {
      coerced[field.name] = coerceFieldValue(field, field.defaultValue)
      continue
    }
    missing.push(field.name)
  }
  if (missing.length > 0) {
    throw new Error(`Missing required wizard field${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`)
  }

  // Final validation against the same Zod schema the wizard UI uses.
  const schema = buildFormSchema(fields)
  const parsed = schema.safeParse(coerced)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")
    throw new Error(`Wizard validation failed:\n${issues}`)
  }
  return parsed.data as Record<string, unknown>
}

function readWizardFile(p: string | undefined): Record<string, unknown> {
  if (!p) return {}
  const raw = fs.readFileSync(p, "utf8")
  const parsed = JSON.parse(raw) as unknown
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`--wizard-file must contain a JSON object of field-name → value, got: ${typeof parsed}`)
  }
  return parsed as Record<string, unknown>
}

function main(): void {
  const args = parseCli()
  const templatePath = resolveTemplatePath(args.template)
  const template = JSON.parse(fs.readFileSync(templatePath, "utf8")) as ProjectTemplate

  const fileVals = readWizardFile(args.wizardFile)
  const templateData = buildTemplateData(template, fileVals, args.wizardKv)
  console.info(`Wizard data validated against ${path.basename(templatePath)}:`)
  for (const [k, v] of Object.entries(templateData)) {
    const preview = typeof v === "string" && v.length > 80 ? `${v.slice(0, 80)}…` : JSON.stringify(v)
    console.info(`  ${k} = ${preview}`)
  }

  const targetDir = getProjectsFolder()
  const safeName = sanitizeProjectName(args.name)
  const targetPath = path.join(targetDir, `${safeName}.sqlite`)
  if (fs.existsSync(targetPath)) {
    throw new Error(`Target project file already exists: ${targetPath}. Pick a different --name or delete the file.`)
  }

  // Read AI settings from source project BEFORE we open the target — the
  // engine forbids opening two project DBs at once. getProjectSettings
  // closes the source automatically.
  let importedSettings: Partial<ReturnType<typeof getProjectSettings>> | null = null
  if (args.copySettingsFrom) {
    const srcPath = resolveProjectPath(args.copySettingsFrom)
    console.info(`Reading AI settings from: ${srcPath}`)
    importedSettings = getProjectSettings(srcPath)
  }

  console.info(`Creating project: ${targetPath}`)
  const result = createProject({
    title: args.name,
    templateFilePath: templatePath,
    templateData,
  })
  console.info(`Created. reused=${"reused" in result && result.reused ? "true" : "false"}`)

  if (importedSettings) {
    console.info("Applying imported AI settings…")
    applyProjectSettings(importedSettings)
  }

  setCurrentDbPath(null)
  console.info("Done.")
}

try {
  main()
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err)
  process.stderr.write(`${msg}\n`)
  process.exit(1)
}
