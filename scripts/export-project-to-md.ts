#!/usr/bin/env tsx
import fs from "node:fs"
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
 *     --final-node "Сборка драфта" \
 *     [--language ru] \
 *     [--output <path>]
 *
 * Or pass a full path to the .sqlite as --project.
 *
 * `--final-node` is required: the script can't reliably guess which plan node
 * holds the finished prose — different templates use different titles
 * («Сборка драфта», «Сборка финала», …) and the safe path is to ask the
 * caller.
 */
import Database from "better-sqlite3"
import { getProjectsFolder, resolveProjectPath } from "./lib/project-paths.js"

interface CliArgs {
  project: string
  template: string
  genre: string
  finalNode: string
  language?: string
  output?: string
}

function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      project: { type: "string" },
      template: { type: "string" },
      genre: { type: "string" },
      "final-node": { type: "string" },
      language: { type: "string" },
      output: { type: "string" },
    },
  })
  if (!values.project || !values.template || !values.genre || !values["final-node"]) {
    process.stderr.write(
      "usage: tsx scripts/export-project-to-md.ts " +
        '--project <name-or-path> --template <fiction-arc.ru.json> --genre <genre> --final-node "<plan-node title>" ' +
        "[--language <code>] [--output <path>]\n",
    )
    process.exit(2)
  }
  return {
    project: values.project,
    template: values.template,
    genre: values.genre,
    finalNode: values["final-node"],
    language: values.language,
    output: values.output,
  }
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

/** Caller passes the title of the plan node that holds the finished prose. */
function findFinalResult(db: Database.Database, title: string): FinalResult {
  const c = readNodeContent(db, title)
  if (c && c.trim().length > 0) return { title, content: c }
  throw new Error(
    `Plan node "${title}" has no content. ` +
      `Make sure the title is right and the generation pipeline ran end-to-end and refreshed this node.`,
  )
}

interface AggregatedStats {
  totalCalls: number
  totalDurationMs: number
  totalCostUsd: number | null
  callsWithCost: number
  wallTimeMs: number | null
}

interface PlanNodeForCost {
  id: number
  parent_id: number | null
  title: string
}

interface CallRowForCost {
  ts: string
  purpose: string
  node_title: string | null
  duration_ms: number
  cost_usd: number | null
  iteration_index: number | null
}

/**
 * Cost/duration of a single full pipeline run, derived from `ai_call_stats`.
 *
 * Why this isn't a plain SUM: during development a node may be regenerated
 * many times, but only the latest run contributes to the final output. For
 * each (node_title, purpose, iteration_index) tuple we keep at most N most-
 * recent successful records, where N is the number of times that node fires
 * in one pipeline run — 1 for nodes outside any for-each, `chunksCount` for
 * nodes inside the «Цикл по чанкам» for-each. Records whose `node_title` is
 * no longer in the project's plan graph (renamed / removed nodes) are
 * dropped: a fresh run won't pay for them.
 */
function aggregateStats(db: Database.Database): AggregatedStats {
  const nodes = db.prepare<[], PlanNodeForCost>("SELECT id, parent_id, title FROM plan_nodes").all()
  const cycle = nodes.find((n) => n.title === "Цикл по чанкам")
  let chunksCount = 1
  if (cycle) {
    const row = db.prepare("SELECT content FROM plan_nodes WHERE id = ?").get(cycle.id) as
      | { content: string | null }
      | undefined
    try {
      const parsed = JSON.parse(row?.content || "{}") as { length?: number }
      if (typeof parsed.length === "number" && parsed.length > 0) chunksCount = parsed.length
    } catch {
      // leave at 1
    }
  }

  const byId = new Map(nodes.map((n) => [n.id, n] as const))
  const insideCycle = (id: number): boolean => {
    let cur = byId.get(id)
    while (cur && cur.parent_id != null) {
      if (cur.parent_id === cycle?.id) return true
      cur = byId.get(cur.parent_id)
    }
    return false
  }
  const titleInside = new Map<string, boolean>()
  for (const n of nodes) {
    const flag = (cycle && n.id === cycle.id) || insideCycle(n.id)
    const prev = titleInside.get(n.title)
    titleInside.set(n.title, prev === undefined ? flag : prev || flag)
  }

  const rows = db
    .prepare<[], CallRowForCost>(
      "SELECT ts, purpose, node_title, duration_ms, cost_usd, iteration_index FROM ai_call_stats WHERE success = 1 ORDER BY ts DESC",
    )
    .all()

  // Group by (node_title, purpose, iteration_index), keep top N per (node_title).
  const seenPerTitleKey = new Map<string, number>()
  let totalCalls = 0
  let totalDurationMs = 0
  let totalCostUsd = 0
  let callsWithCost = 0
  for (const r of rows) {
    const title = r.node_title ?? "(no title)"
    // Records from removed / renamed nodes are skipped — a fresh run wouldn't
    // pay for them. Allow "(no title)" records (e.g. generate-summary calls
    // that didn't carry node_title) to pass through.
    if (!titleInside.has(title) && title !== "(no title)") continue
    const inside = titleInside.get(title) ?? false
    const expectedN = inside ? chunksCount : 1
    const groupKey = `${title}|${r.purpose}|${r.iteration_index ?? "null"}`
    const so_far = seenPerTitleKey.get(groupKey) ?? 0
    if (so_far >= expectedN) continue
    seenPerTitleKey.set(groupKey, so_far + 1)
    totalCalls += 1
    totalDurationMs += r.duration_ms
    if (typeof r.cost_usd === "number" && Number.isFinite(r.cost_usd)) {
      totalCostUsd += r.cost_usd
      callsWithCost += 1
    }
  }

  const wallRow = db.prepare("SELECT SUM(wall_time_ms) AS w FROM ai_run_stats").get() as { w: number | null }
  return {
    totalCalls,
    totalDurationMs,
    totalCostUsd: callsWithCost > 0 ? totalCostUsd : null,
    callsWithCost,
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

interface TemplateWizardField {
  name: string
  label: string
  type: string
}

interface TemplatePlanNode {
  title: string
  type: string
  content?: string[]
  aiUserInstructions?: string[]
  nodeTypeSettings?: Record<string, unknown>
  children?: TemplatePlanNode[]
}

interface TemplateSummary {
  label: string
  fields: TemplateWizardField[]
  planNodes: TemplatePlanNode[]
}

function flattenPlanNodes(nodes: TemplatePlanNode[] | undefined, out: TemplatePlanNode[] = []): TemplatePlanNode[] {
  if (!nodes) return out
  for (const n of nodes) {
    out.push(n)
    if (n.children) flattenPlanNodes(n.children, out)
  }
  return out
}

function loadTemplate(filename: string): TemplateSummary {
  const candidates = [
    path.join("src/backend/resources/resources/templates", filename),
    // User templates live next to the projects directory under the same data root.
    path.join(getProjectsFolder(), "..", "templates", filename),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        const tpl = JSON.parse(fs.readFileSync(c, "utf8")) as {
          label?: string
          wizardPages?: Array<{ fields?: TemplateWizardField[] }>
          plan?: { nodes?: TemplatePlanNode[] }
        }
        const fields: TemplateWizardField[] = []
        for (const page of tpl.wizardPages ?? []) {
          for (const f of page.fields ?? []) {
            fields.push(f)
          }
        }
        return {
          label: tpl.label ?? filename,
          fields,
          planNodes: flattenPlanNodes(tpl.plan?.nodes),
        }
      } catch {
        // fall through
      }
    }
  }
  return { label: filename, fields: [], planNodes: [] }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Build a regex pattern from a template string by replacing every `${ident}`
 * with a named capture group. Returns null if the template contains a
 * non-trivial expression (formulas like `${round(1400/N)}`) or has zero
 * placeholders.
 */
function templateToPattern(template: string): string | null {
  const re = /\${([^}]+)}/g
  let pattern = "^"
  let lastIdx = 0
  let captures = 0
  const seen = new Set<string>()
  for (const m of template.matchAll(re)) {
    pattern += escapeRegex(template.slice(lastIdx, m.index))
    const inner = m[1].trim()
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(inner)) return null
    if (seen.has(inner)) {
      // Backreference: must match the same captured value.
      pattern += `\\k<${inner}>`
    } else {
      pattern += `(?<${inner}>[\\s\\S]+?)`
      seen.add(inner)
    }
    captures += 1
    lastIdx = (m.index ?? 0) + m[0].length
  }
  if (captures === 0) return null
  pattern += escapeRegex(template.slice(lastIdx))
  pattern += "$"
  return pattern
}

/**
 * Best-effort recovery of wizard inputs for projects created before wizard
 * data was persisted (commit dceba08). Walks the template's plan nodes; for
 * each, builds a regex from its content / aiUserInstructions and matches it
 * against the project's resolved values. Captures values where placeholders
 * are simple `${ident}` references — gives up silently on formulas.
 *
 * Then reverse-derives `ageRating` from a captured `ageRatingLabel` (the
 * apply pipeline does the forward derivation via AGE_RATING_INFO).
 */
function recoverWizardValues(db: Database.Database, planNodes: TemplatePlanNode[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const tNode of planNodes) {
    const projRow = db.prepare("SELECT content, node_type_settings FROM plan_nodes WHERE title = ?").get(tNode.title) as
      | { content: string | null; node_type_settings: string | null }
      | undefined
    if (!projRow) continue

    // content array → resolved content string.
    if (tNode.content && projRow.content) {
      tryCapture(tNode.content.join("\n"), projRow.content, out)
    }

    // aiUserInstructions array → resolved node_type_settings.userPrompt.
    if (tNode.aiUserInstructions && projRow.node_type_settings) {
      try {
        const settings = JSON.parse(projRow.node_type_settings) as Record<string, unknown>
        if (typeof settings.userPrompt === "string") {
          tryCapture(tNode.aiUserInstructions.join("\n"), settings.userPrompt, out)
        }
      } catch {
        // skip
      }
    }
  }

  // Reverse derivation: ageRatingLabel ("18+") → ageRating ("18").
  const labelToCode: Record<string, string> = {
    G: "G",
    PG: "PG",
    "12+": "12",
    "16+": "16",
    "18+": "18",
    "NC-21": "NC21",
  }
  if (out.ageRatingLabel && labelToCode[out.ageRatingLabel] && out.ageRating == null) {
    out.ageRating = labelToCode[out.ageRatingLabel]
  }
  return out
}

function tryCapture(template: string, resolved: string, out: Record<string, string>): void {
  const pattern = templateToPattern(template)
  if (!pattern) return
  try {
    const re = new RegExp(pattern, "s")
    const match = re.exec(resolved)
    if (!match?.groups) return
    for (const [name, value] of Object.entries(match.groups)) {
      if (out[name] === undefined && value != null) out[name] = value
    }
  } catch {
    // Pathological regex — ignore.
  }
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

  const template = loadTemplate(args.template)

  // Wizard data: persisted setting is the source of truth — it's what the user
  // typed into the wizard. We additionally extract values from the project's
  // resolved instructions/content and warn on any mismatch (user edited a
  // substituted prompt directly, or the persisted record is stale). Old
  // projects predating wizard-data persistence end up with an empty record;
  // for those, the extracted values are the only option.
  const wizardSetting = readSettingJson(db, "applied_template_wizard_data") as Record<string, unknown> | null
  const savedWizard: Record<string, unknown> =
    wizardSetting && Object.keys(wizardSetting).length > 0 ? { ...wizardSetting } : {}
  const extractedWizard = recoverWizardValues(db, template.planNodes)

  // Warn about mismatches (saved says X, project content says Y). Compare on
  // normalized values (trim + collapse line endings) so cosmetic whitespace
  // doesn't produce false alarms. WARN output never dumps the full values —
  // they may be long or sensitive (project synopses).
  const norm = (s: string): string => s.replace(/\r\n?/g, "\n").trim()
  const shortPreview = (s: string): string => {
    const collapsed = s.replace(/\s+/g, " ").trim()
    return collapsed.length > 80 ? `${collapsed.slice(0, 80)}…` : collapsed
  }
  const conflicts: Array<{ field: string; saved: string; extracted: string }> = []
  for (const [name, savedValue] of Object.entries(savedWizard)) {
    const extractedValue = extractedWizard[name]
    if (extractedValue != null && norm(String(savedValue)) !== norm(extractedValue)) {
      conflicts.push({ field: name, saved: String(savedValue), extracted: extractedValue })
    }
  }
  for (const c of conflicts) {
    process.stderr.write(
      `WARN: wizard field "${c.field}" mismatch — ` +
        `saved (${c.saved.length} chars): "${shortPreview(c.saved)}"; ` +
        `extracted (${c.extracted.length} chars): "${shortPreview(c.extracted)}". ` +
        "Someone likely edited a substituted prompt directly. Preamble will show the saved value.\n",
    )
  }

  // For fields missing in saved, fall back to extracted (covers pre-persistence projects).
  const wizardData: Record<string, unknown> = { ...savedWizard }
  for (const [name, value] of Object.entries(extractedWizard)) {
    if (wizardData[name] == null) wizardData[name] = value
  }
  const usedExtractionForFields = Object.keys(extractedWizard).filter((n) => savedWizard[n] == null)
  if (usedExtractionForFields.length > 0) {
    process.stderr.write(
      `INFO: project has no persisted wizard data for: ${usedExtractionForFields.join(", ")}. ` +
        "Falling back to values extracted from the project's resolved content.\n",
    )
  }

  const currentBackend = readSettingJson(db, "current_backend") as string | null
  const aiConfig = readSettingJson(db, "ai_config") as Record<string, unknown> | null
  const engineConfig = currentBackend && aiConfig ? (aiConfig[currentBackend] as Record<string, unknown>) : null
  const textSettings = (engineConfig?.defaultAiGenerationSettings as Record<string, unknown> | undefined) ?? {}
  const summarySettings = (engineConfig?.summaryAiGenerationSettings as Record<string, unknown> | undefined) ?? {}

  const language = args.language ?? languageFromTemplate(args.template)

  const final = findFinalResult(db, args.finalNode)
  const stats = aggregateStats(db)

  const partsCount = wizardData.partsCount
  const modelName = textSettings.model ? String(textSettings.model) : null
  // Build tag list; drop any tag whose source value is missing. Then sanitize
  // the joined string for Windows-illegal characters (`<>:"/\|?*`) just in
  // case a wizard value contains one.
  const tagCandidates: Array<string | null> = [
    templateSlug(args.template),
    args.genre,
    partsCount != null ? `${partsCount} parts` : null,
    modelName,
    language && language !== "?" ? language : null,
  ]
  const tags = tagCandidates.filter((t): t is string => !!t).join(", ")
  const safeName = `${projectName} [${tags}].md`.replace(/[<>:"/\\|?*]/g, "-")
  const outputPath = args.output ?? path.join(projectDir, safeName)

  const out: string[] = []
  out.push(`**Template:** ${template.label} (\`${args.template}\`)  `)
  out.push(`**Genre:** ${args.genre}  `)
  out.push(`**Language:** ${language}  `)
  out.push("")

  // Wizard inputs — emit every field declared in the template's wizardPages,
  // using the template-author's label as the heading. Long / multi-line values
  // go into a blockquote on the next paragraph; short scalar values stay inline.
  // Fields the user didn't fill (or that weren't persisted) are skipped.
  if (template.fields.length > 0 && Object.keys(wizardData).length > 0) {
    out.push("## Wizard inputs")
    out.push("")
    for (const field of template.fields) {
      const raw = wizardData[field.name]
      if (raw == null) continue
      const value = String(raw)
      const isBlock = value.includes("\n") || value.length > 120
      if (isBlock) {
        out.push(`**${field.label}:**`)
        out.push("")
        out.push(quoteBlock(value))
        out.push("")
      } else {
        out.push(`**${field.label}:** ${value}  `)
      }
    }
    out.push("")
  }

  out.push(`**Engine:** ${currentBackend ?? "?"}  `)
  out.push("")
  out.push("**LLM settings (text):**")
  out.push("")
  out.push("```json")
  out.push(JSON.stringify(sanitizeEngineConfig(textSettings), null, 2))
  out.push("```")
  out.push("")
  out.push("**LLM settings (summary):**")
  out.push("")
  out.push("```json")
  out.push(JSON.stringify(sanitizeEngineConfig(summarySettings), null, 2))
  out.push("```")
  out.push("")
  out.push(`**Total LLM calls:** ${stats.totalCalls}  `)
  out.push(`**Sum of LLM call durations:** ${formatDuration(stats.totalDurationMs)}  `)
  if (stats.wallTimeMs != null && stats.wallTimeMs > 0) {
    out.push(`**Wall-clock duration:** ${formatDuration(stats.wallTimeMs)}  `)
  }
  if (stats.totalCostUsd != null) {
    const note =
      stats.callsWithCost < stats.totalCalls
        ? ` (provider reported cost on ${stats.callsWithCost} of ${stats.totalCalls} calls)`
        : ""
    out.push(`**Total cost:** $${stats.totalCostUsd.toFixed(4)}${note}  `)
  } else {
    out.push("**Total cost:** provider did not report a cost for any of these calls  ")
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
