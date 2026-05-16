#!/usr/bin/env tsx
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import { parseArgs } from "node:util"
/**
 * Export a generated project's final result to a Markdown file inside the
 * project's folder (next to the .sqlite).
 *
 * Filename: `<projectName> [<tags>].md`.
 * Tags are template name, genre, parts count, model, language.
 * Project name is taken from the sqlite filename. Genre and template are
 * passed via CLI because the project sqlite doesn't store them.
 *
 * Auto-detected when present:
 *   - Wizard data from `applied_template_wizard_data` (falls back to plan node
 *     content of «Синопсис» when the setting is empty — older projects didn't
 *     persist wizard data).
 *   - Engine / model / params from `ai_config` + `current_backend`.
 *   - Language from the template filename (e.g. `fiction-arc.ru.json` → `ru`).
 *   - Total time / cost from `ai_call_stats`.
 *
 * Usage:
 *   npx tsx scripts/export-project-to-md.ts \
 *     --project "Письмо" \
 *     --template fiction-arc.ru.json \
 *     --genre "литдрама" \
 *     [--language ru] \
 *     [--output <path>]
 *
 * Or pass a full path to the .sqlite as --project.
 */
import Database from "better-sqlite3"

interface CliArgs {
  project: string
  template: string
  genre: string
  language?: string
  output?: string
}

function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      project: { type: "string" },
      template: { type: "string" },
      genre: { type: "string" },
      language: { type: "string" },
      output: { type: "string" },
    },
  })
  if (!values.project || !values.template || !values.genre) {
    process.stderr.write(
      "usage: tsx scripts/export-project-to-md.ts " +
        "--project <name-or-path> --template <fiction-arc.ru.json> " +
        "--genre <genre> [--language <code>] [--output <path>]\n",
    )
    process.exit(2)
  }
  return values as CliArgs
}

function defaultProjectsDir(): string {
  // Mirrors the Electron `app.getPath("userData")/projects` location.
  return path.join(os.homedir(), "AppData", "Roaming", "ai-story-builder", "projects")
}

function resolveProjectPath(spec: string): string {
  if (fs.existsSync(spec) && fs.statSync(spec).isFile()) return spec
  const dir = defaultProjectsDir()
  for (const candidate of [path.join(dir, spec), path.join(dir, `${spec}.sqlite`)]) {
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error(`Project not found: tried ${spec} and ${dir}\\${spec}{,.sqlite}`)
}

function readSettingJson(db: Database.Database, key: string): unknown {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined
  if (!row) return null
  try {
    return JSON.parse(row.value)
  } catch {
    return row.value
  }
}

function readNodeContent(db: Database.Database, title: string): string | null {
  const row = db.prepare("SELECT content FROM plan_nodes WHERE title = ?").get(title) as
    | { content: string | null }
    | undefined
  return row?.content ?? null
}

interface FinalResult {
  title: string
  content: string
}

/**
 * Try the most downstream merge node first; fall through to upstream drafts.
 * Whichever has non-empty content wins.
 */
function findFinalResult(db: Database.Database): FinalResult {
  const candidates = ["Сборка финала", "Сборка прозы", "Сборка второго драфта", "Сборка первого драфта"]
  for (const title of candidates) {
    const c = readNodeContent(db, title)
    if (c && c.trim().length > 0) return { title, content: c }
  }
  throw new Error(
    `No final merge node has content. Tried: ${candidates.join(", ")}. ` +
      `Make sure the generation pipeline ran end-to-end and the final merge was refreshed.`,
  )
}

interface AggregatedStats {
  totalCalls: number
  totalDurationMs: number
  totalCostUsd: number | null
  callsWithCost: number
  wallTimeMs: number | null
}

function aggregateStats(db: Database.Database): AggregatedStats {
  const callRow = db
    .prepare(
      "SELECT COUNT(*) AS n, SUM(duration_ms) AS d, SUM(cost_usd) AS c, COUNT(cost_usd) AS hasCost FROM ai_call_stats",
    )
    .get() as { n: number; d: number | null; c: number | null; hasCost: number }
  const wallRow = db.prepare("SELECT SUM(wall_time_ms) AS w FROM ai_run_stats").get() as { w: number | null }
  return {
    totalCalls: callRow.n,
    totalDurationMs: callRow.d ?? 0,
    totalCostUsd: callRow.hasCost > 0 ? callRow.c : null,
    callsWithCost: callRow.hasCost,
    wallTimeMs: wallRow.w,
  }
}

function formatDuration(ms: number): string {
  const sec = Math.round(ms / 1000)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}ч ${m}м ${s}с`
  if (m > 0) return `${m}м ${s}с`
  return `${s}с`
}

function sanitizeEngineConfig(cfg: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!cfg) return {}
  const out: Record<string, unknown> = { ...cfg }
  for (const k of ["api_key", "management_key"]) delete out[k]
  return out
}

function languageFromTemplate(templateFile: string): string {
  const m = templateFile.match(/\.(\w{2,3})\.json$/)
  return m ? m[1] : "?"
}

function loadTemplateLabel(filename: string): string {
  const candidates = [
    path.join("src/backend/resources/resources/templates", filename),
    path.join(os.homedir(), "AppData", "Roaming", "ai-story-builder", "templates", filename),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        const tpl = JSON.parse(fs.readFileSync(c, "utf8")) as { label?: string }
        if (tpl.label) return tpl.label
      } catch {
        // fall through
      }
    }
  }
  return filename
}

function templateSlug(templateFile: string): string {
  // fiction-arc.ru.json → fiction-arc
  return templateFile.replace(/\.\w{2,3}\.json$/, "").replace(/\.json$/, "")
}

function quoteBlock(text: string): string {
  return text
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n")
}

function main() {
  const args = parseCli()
  const projectPath = resolveProjectPath(args.project)
  const projectDir = path.dirname(projectPath)
  const projectName = path.basename(projectPath, ".sqlite")

  const db = new Database(projectPath, { readonly: true, fileMustExist: true })

  // Wizard data: prefer the persisted setting; fall back to plan-node content
  // for known wizard fields (older projects didn't persist wizard data).
  const wizardSetting = readSettingJson(db, "applied_template_wizard_data") as Record<string, unknown> | null
  const wizardData: Record<string, unknown> =
    wizardSetting && Object.keys(wizardSetting).length > 0 ? { ...wizardSetting } : {}
  if (wizardData.synopsis == null) {
    const s = readNodeContent(db, "Синопсис")
    if (s && s.trim().length > 0) wizardData.synopsis = s.trim()
  }

  const currentBackend = readSettingJson(db, "current_backend") as string | null
  const aiConfig = readSettingJson(db, "ai_config") as Record<string, unknown> | null
  const engineConfig = currentBackend && aiConfig ? (aiConfig[currentBackend] as Record<string, unknown>) : null
  const textSettings = (engineConfig?.defaultAiGenerationSettings as Record<string, unknown> | undefined) ?? {}
  const summarySettings = (engineConfig?.summaryAiGenerationSettings as Record<string, unknown> | undefined) ?? {}

  const templateLabel = loadTemplateLabel(args.template)
  const language = args.language ?? languageFromTemplate(args.template)

  const final = findFinalResult(db)
  const stats = aggregateStats(db)

  const partsCount = wizardData.partsCount
  const modelName = textSettings.model ? String(textSettings.model) : null
  // Build tag list; drop any tag whose source value is missing. Then sanitize
  // the joined string for Windows-illegal characters (`<>:"/\|?*`) just in
  // case a wizard value contains one.
  const tagCandidates: Array<string | null> = [
    templateSlug(args.template),
    args.genre,
    partsCount != null ? `${partsCount} частей` : null,
    modelName,
    language && language !== "?" ? language : null,
  ]
  const tags = tagCandidates.filter((t): t is string => !!t).join(", ")
  const safeName = `${projectName} [${tags}].md`.replace(/[<>:"/\\|?*]/g, "-")
  const outputPath = args.output ?? path.join(projectDir, safeName)

  const out: string[] = []
  out.push(`**Шаблон:** ${templateLabel} (\`${args.template}\`)  `)
  out.push(`**Жанр:** ${args.genre}  `)
  out.push(`**Язык:** ${language}  `)
  if (wizardData.ageRating != null) out.push(`**Возрастной рейтинг:** ${wizardData.ageRating}  `)
  if (wizardData.partsCount != null) out.push(`**Число частей:** ${wizardData.partsCount}  `)
  out.push("")
  if (wizardData.synopsis != null) {
    out.push("**Синопсис:**")
    out.push("")
    out.push(quoteBlock(String(wizardData.synopsis)))
    out.push("")
  }
  out.push(`**Engine:** ${currentBackend ?? "?"}  `)
  out.push("")
  out.push("**LLM-параметры (текст):**")
  out.push("")
  out.push("```json")
  out.push(JSON.stringify(sanitizeEngineConfig(textSettings), null, 2))
  out.push("```")
  out.push("")
  out.push("**LLM-параметры (сводка):**")
  out.push("")
  out.push("```json")
  out.push(JSON.stringify(sanitizeEngineConfig(summarySettings), null, 2))
  out.push("```")
  out.push("")
  out.push(`**Всего LLM-вызовов:** ${stats.totalCalls}  `)
  out.push(`**Суммарное время LLM-вызовов:** ${formatDuration(stats.totalDurationMs)}  `)
  if (stats.wallTimeMs != null && stats.wallTimeMs > 0) {
    out.push(`**Wall-clock время прогонов:** ${formatDuration(stats.wallTimeMs)}  `)
  }
  if (stats.totalCostUsd != null) {
    const note =
      stats.callsWithCost < stats.totalCalls ? ` (по ${stats.callsWithCost} из ${stats.totalCalls} вызовов)` : ""
    out.push(`**Суммарная стоимость:** $${stats.totalCostUsd.toFixed(4)}${note}  `)
  } else {
    out.push("**Суммарная стоимость:** провайдер не отчитался о стоимости для этих вызовов  ")
  }
  out.push("")
  out.push("---")
  out.push("")
  out.push(`# ${projectName}`)
  out.push("")
  out.push(final.content.trim())
  out.push("")

  fs.writeFileSync(outputPath, out.join("\n"), "utf8")
  process.stdout.write(`Exported: ${outputPath}\n`)
  process.stdout.write(`  source merge node: «${final.title}»  (${final.content.length} chars)\n`)
}

main()
