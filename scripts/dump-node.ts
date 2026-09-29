#!/usr/bin/env tsx
/**
 * Print a plan node's stored content (or a structured render of it) from one
 * or more project sqlites to stdout.
 *
 * Read-only: doesn't run regeneration, doesn't touch the graph.
 *
 *   # raw content of one node in one project (header to stderr, body to stdout)
 *   npx tsx scripts/dump-node.ts --project "Письмо" --node-title "Мир"
 *
 *   # same across four projects (loop with project label headers)
 *   npx tsx scripts/dump-node.ts \
 *     --projects "Письмо,Гонец,Тень,В баре" \
 *     --node-title "План сцен"
 *
 *   # a node inside a loop, in one iteration; without --iteration, in every
 *   # iteration the loop has (--path names an iteration of nested loops)
 *   npx tsx scripts/dump-node.ts --project "В баре" --node-title "Проза чанка" --iteration 0
 *   npx tsx scripts/dump-node.ts --project "В баре" --node-title "Профиль персонажа"
 *   npx tsx scripts/dump-node.ts --project "В баре" --node-title "Текст сцены" --path "21:0/40:2"
 *
 *   # one-line summary (chars + words + status) — handy across many projects
 *   npx tsx scripts/dump-node.ts \
 *     --projects "Письмо,Гонец,Тень,В баре" \
 *     --node-title "Проза чанка" \
 *     --summary
 *
 *   # structured render of a fix-problems node's iterations (passes, problems,
 *   # severities, output sizes) instead of the raw JSON blob
 *   npx tsx scripts/dump-node.ts \
 *     --project "Письмо" \
 *     --node-title "Ревью плана сцен: качество" \
 *     --format fix-problems
 *
 * Pass --quiet to suppress the project/node header in plain-raw mode (handy
 * when piping `> file.md`).
 */
import process from "node:process"
import { Command, InvalidArgumentError } from "commander"
import { setCurrentDbPath } from "../src/backend/db/state.js"
import { PlanNodeRepository } from "../src/backend/plan/nodes/plan-node-repository.js"
import { PlanNodeService } from "../src/backend/plan/nodes/plan-node-service.js"
import { loopLength } from "../src/shared/for-each-plan-node.js"
import type { PlanNodeDefinition, PlanNodeRow } from "../src/shared/plan-graph.js"
import { childPath, type NodePath, ROOT_PATH } from "../src/shared/plan-node-path.js"
import { openProject } from "./lib/project-paths.js"

type Format = "raw" | "fix-problems"

interface CliArgs {
  projects: string[]
  nodeId?: number
  nodeTitle?: string
  iteration?: number
  path?: NodePath
  format: Format
  summary: boolean
  quiet: boolean
}

interface FoundProblem {
  severity?: number
  description?: string
  [k: string]: unknown
}
interface FixIteration {
  input?: string
  findProblemsResult?: { foundProblems?: FoundProblem[] }
  fixProblemsResult?: string
}
interface FixContent {
  iterations?: FixIteration[]
}

function parsePositiveInt(value: string, name: string): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) throw new InvalidArgumentError(`${name} must be a positive integer`)
  return n
}

function parseNonNegativeInt(value: string, name: string): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0) throw new InvalidArgumentError(`${name} must be a non-negative integer`)
  return n
}

function parseFormat(value: string): Format {
  if (value !== "raw" && value !== "fix-problems") {
    throw new InvalidArgumentError("must be 'raw' or 'fix-problems'")
  }
  return value
}

function parseCli(): CliArgs {
  const program = new Command()
    .name("dump-node")
    .description("Print a plan node's stored content from one or more project sqlites to stdout.")
    .option("--project <name-or-path...>", "Project name or path; pass flag multiple times for multiple projects")
    .option("--projects <a,b,c>", "Comma-separated list of project names (alternative to repeating --project)")
    .option("--node-id <id>", "Node ID (positive integer)", (v) => parsePositiveInt(v, "--node-id"))
    .option("--node-title <title>", "Node title (must be unique; use --node-id to disambiguate)")
    .option("--iteration <index>", "Zero-based iteration of the loop the node is in (default: every one)", (v) =>
      parseNonNegativeInt(v, "--iteration"),
    )
    .option("--path <path>", "One iteration as a full path, for nested loops: '21:0/40:2'")
    .option("--format <kind>", "Output rendering: raw | fix-problems", parseFormat, "raw" as Format)
    .option("--summary", "Print a one-line size + status summary instead of the full content", false)
    .option("--quiet", "Suppress the project/node header (useful when piping to a file)", false)
    .parse()
  const opts = program.opts<{
    project?: string[]
    projects?: string
    nodeId?: number
    nodeTitle?: string
    iteration?: number
    path?: string
    format: Format
    summary: boolean
    quiet: boolean
  }>()
  const projects: string[] = []
  for (const p of opts.project ?? []) projects.push(p)
  if (opts.projects) {
    for (const p of opts.projects.split(",")) {
      const t = p.trim()
      if (t) projects.push(t)
    }
  }
  if (projects.length === 0) program.error("Pass --project (one or more) or --projects <a,b,c>")
  if (!opts.nodeId && !opts.nodeTitle) program.error("Pass --node-id or --node-title")
  if (opts.nodeId && opts.nodeTitle) program.error("Pass either --node-id or --node-title, not both.")
  if (opts.path !== undefined && opts.iteration !== undefined) program.error("Pass either --path or --iteration.")
  return {
    projects,
    nodeId: opts.nodeId,
    nodeTitle: opts.nodeTitle,
    iteration: opts.iteration,
    path: opts.path,
    format: opts.format,
    summary: opts.summary,
    quiet: opts.quiet,
  }
}

function resolveNode(args: CliArgs): PlanNodeDefinition {
  const repo = new PlanNodeRepository()
  const all = repo.findAll()
  if (args.nodeId != null) {
    const n = all.find((x) => x.id === args.nodeId)
    if (!n) throw new Error(`No node with id ${args.nodeId}`)
    return n
  }
  const matches = all.filter((n) => n.title === args.nodeTitle)
  if (matches.length === 0) throw new Error(`No node with title ${JSON.stringify(args.nodeTitle)}`)
  if (matches.length > 1) {
    const list = matches.map((n) => `#${n.id} (${n.type})`).join(", ")
    throw new Error(`Title ${JSON.stringify(args.nodeTitle)} is not unique — pass --node-id. Matches: ${list}`)
  }
  return matches[0]
}

/** The paths to dump the node at: the one asked for, or every iteration its loops have. */
function pathsOf(service: PlanNodeService, node: PlanNodeDefinition, args: CliArgs): NodePath[] {
  if (args.path !== undefined) return [args.path]
  let paths: NodePath[] = [ROOT_PATH]
  const loops = service.loopsAround(node.id)
  loops.forEach((loop, depth) => {
    const innermost = depth === loops.length - 1
    paths = paths.flatMap((p) =>
      innermost && args.iteration !== undefined
        ? [childPath(p, loop, args.iteration)]
        : Array.from({ length: loopLength(service.getRow(loop, p).content) }, (_, i) => childPath(p, loop, i)),
    )
  })
  return paths
}

function reportSummary(label: string, status: string, type: string, content: string): void {
  const chars = content.length
  const words = content.trim() === "" ? 0 : content.trim().split(/\s+/).length
  const firstLine =
    content
      .split("\n")
      .find((l) => l.trim().length > 0)
      ?.slice(0, 70) ?? ""
  console.info(
    `${label.padEnd(40)} ${type.padEnd(14)} ${status.padEnd(10)} ${String(chars).padStart(7)}c ~${String(words).padStart(6)}w  ${firstLine}`,
  )
}

function reportFixProblems(label: string, content: string): void {
  let parsed: FixContent = {}
  try {
    parsed = JSON.parse(content || "{}") as FixContent
  } catch {
    process.stderr.write(`[warn] ${label}: content is not valid JSON\n`)
  }
  const iterations = parsed.iterations ?? []
  const inputLen = iterations[0]?.input?.length ?? 0
  const finalLen = iterations[iterations.length - 1]?.fixProblemsResult?.length ?? 0
  console.info(`\n===== ${label}: ${iterations.length} fix-pass(es) =====`)
  console.info(`  raw input: ${inputLen} chars; final fixed: ${finalLen} chars`)
  iterations.forEach((it, idx) => {
    const problems = it.findProblemsResult?.foundProblems ?? []
    console.info(`  pass ${idx}: ${problems.length} problem(s)`)
    for (const p of problems) {
      const sev = p.severity != null ? `sev=${p.severity}` : "sev=?"
      const desc = typeof p.description === "string" ? p.description : JSON.stringify(p.description)
      console.info(`    [${sev}] ${desc}`)
    }
    if (it.fixProblemsResult) console.info(`  pass ${idx}: applied fix → ${it.fixProblemsResult.length} chars`)
  })
}

function reportRaw(label: string, content: string, quiet: boolean): void {
  if (!quiet) {
    process.stderr.write(`===== ${label}: ${content.length} chars =====\n`)
  }
  process.stdout.write(content)
  if (content.length > 0 && !content.endsWith("\n")) process.stdout.write("\n")
}

function dumpForProject(args: CliArgs, projectName: string): void {
  openProject(projectName)
  try {
    const node = resolveNode(args)
    const service = new PlanNodeService()
    for (const path of pathsOf(service, node, args)) {
      const row: PlanNodeRow = service.getRow(node.id, path)
      const content = row.content ?? ""
      const iterLabel = path === ROOT_PATH ? "" : ` / at ${path}`
      const label = `${projectName} / #${node.id} '${node.title}' (${node.type}) / ${row.status}${iterLabel}`
      if (args.summary) {
        reportSummary(`${projectName}${iterLabel}`, row.status, node.type, content)
      } else if (args.format === "fix-problems") {
        reportFixProblems(label, content)
      } else {
        reportRaw(label, content, args.quiet)
      }
    }
  } finally {
    setCurrentDbPath(null)
  }
}

try {
  const args = parseCli()
  for (const name of args.projects) dumpForProject(args, name)
} catch (err) {
  const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err)
  process.stderr.write(`${msg}\n`)
  process.exit(1)
}
