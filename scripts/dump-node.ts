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
 *   # a single iteration of a for-each-internal node (reads from the
 *   # container's overrides[i] if i is not currently mounted, otherwise from
 *   # the live node content). --all-iterations walks every iteration.
 *   npx tsx scripts/dump-node.ts --project "В баре" --node-title "Проза чанка" --iteration 0
 *   npx tsx scripts/dump-node.ts --project "В баре" --node-title "Профиль персонажа" --all-iterations
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
import { parseArgs } from "node:util"
import { setCurrentDbPath } from "../src/backend/db/state.js"
import { PlanNodeRepository } from "../src/backend/plan/nodes/plan-node-repository.js"
import type { PlanNodeRow } from "../src/shared/plan-graph.js"
import { resolveProjectPath } from "./lib/project-paths.js"

type Format = "raw" | "fix-problems"

interface CliArgs {
  projects: string[]
  nodeId?: number
  nodeTitle?: string
  iteration?: number
  allIterations: boolean
  format: Format
  summary: boolean
  quiet: boolean
}

interface ForEachOverrideSlot {
  content?: string | null
  status?: string | null
}
interface ForEachContent {
  overrides?: Array<Record<string, ForEachOverrideSlot>>
  length?: number
  currentIndex?: number
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

function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      project: { type: "string", multiple: true },
      projects: { type: "string" },
      "node-id": { type: "string" },
      "node-title": { type: "string" },
      iteration: { type: "string" },
      "all-iterations": { type: "boolean", default: false },
      format: { type: "string", default: "raw" },
      summary: { type: "boolean", default: false },
      quiet: { type: "boolean", default: false },
    },
  })
  const projects: string[] = []
  for (const p of (values.project as string[] | undefined) ?? []) projects.push(p)
  if (values.projects) {
    for (const p of values.projects.split(",")) {
      const t = p.trim()
      if (t) projects.push(t)
    }
  }
  if (projects.length === 0 || (!values["node-id"] && !values["node-title"])) {
    process.stderr.write(
      "usage: tsx scripts/dump-node.ts " +
        "(--project <name>… | --projects <a,b,c>) " +
        "(--node-id <n> | --node-title <title>) " +
        "[--iteration <i> | --all-iterations] " +
        "[--format raw|fix-problems] " +
        "[--summary] " +
        "[--quiet]\n",
    )
    process.exit(2)
  }
  if (values["node-id"] && values["node-title"]) {
    process.stderr.write("Pass either --node-id or --node-title, not both.\n")
    process.exit(2)
  }
  let nodeId: number | undefined
  if (values["node-id"]) {
    nodeId = Number(values["node-id"])
    if (!Number.isInteger(nodeId) || nodeId <= 0) {
      process.stderr.write("--node-id must be a positive integer\n")
      process.exit(2)
    }
  }
  let iteration: number | undefined
  if (values.iteration != null) {
    iteration = Number(values.iteration)
    if (!Number.isInteger(iteration) || iteration < 0) {
      process.stderr.write("--iteration must be a non-negative integer\n")
      process.exit(2)
    }
  }
  const format = values.format as Format
  if (format !== "raw" && format !== "fix-problems") {
    process.stderr.write(`--format must be 'raw' or 'fix-problems' (got ${JSON.stringify(values.format)})\n`)
    process.exit(2)
  }
  return {
    projects,
    nodeId,
    nodeTitle: values["node-title"],
    iteration,
    allIterations: !!values["all-iterations"],
    format,
    summary: !!values.summary,
    quiet: !!values.quiet,
  }
}

function findContainerForChild(allNodes: PlanNodeRow[], child: PlanNodeRow): PlanNodeRow | null {
  let cur: PlanNodeRow | null = child
  while (cur != null) {
    if (cur.type === "for-each") return cur
    if (cur.parent_id == null) return null
    cur = allNodes.find((n) => n.id === cur!.parent_id) ?? null
  }
  return null
}

function resolveNode(args: CliArgs): PlanNodeRow {
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

function getIterationContent(node: PlanNodeRow, container: PlanNodeRow, iteration: number): string {
  const parsed = JSON.parse(container.content || "{}") as ForEachContent
  const currentIndex = parsed.currentIndex ?? 0
  if (iteration === currentIndex) return node.content ?? ""
  return parsed.overrides?.[iteration]?.[String(node.id)]?.content ?? ""
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
  setCurrentDbPath(resolveProjectPath(projectName))
  try {
    const node = resolveNode(args)
    const all = new PlanNodeRepository().findAll()
    const container = findContainerForChild(all, node)

    // Build the list of (label, content) pairs to render.
    interface Slot {
      iterLabel: string
      content: string
    }
    const slots: Slot[] = []
    if (container == null) {
      // Top-level node — iteration flags are ignored.
      slots.push({ iterLabel: "", content: node.content ?? "" })
    } else if (args.iteration != null) {
      slots.push({
        iterLabel: ` / iter ${args.iteration}`,
        content: getIterationContent(node, container, args.iteration),
      })
    } else if (args.allIterations) {
      const parsed = JSON.parse(container.content || "{}") as ForEachContent
      const total = parsed.length ?? parsed.overrides?.length ?? 0
      for (let i = 0; i < total; i++) {
        slots.push({ iterLabel: ` / iter ${i}`, content: getIterationContent(node, container, i) })
      }
    } else {
      // Default for for-each-internal node: dump currently-mounted iteration.
      slots.push({ iterLabel: "", content: node.content ?? "" })
    }

    for (const { iterLabel, content } of slots) {
      const label = `${projectName} / #${node.id} '${node.title}' (${node.type}) / ${node.status}${iterLabel}`
      if (args.summary) {
        reportSummary(`${projectName}${iterLabel}`, node.status, node.type, content)
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
