#!/usr/bin/env tsx
/**
 * Run regeneration for a single plan node, or for an entire project.
 *
 * Wraps `regenerateTreeNodesContents()` — the same path the UI uses. Works
 * for any node type the engine knows how to regenerate (text/split/merge/
 * fix-problems/for-each/lore); not strictly LLM-only.
 *
 *   # single node by id:
 *   npx tsx scripts/regenerate-node.ts \
 *     --project "Письмо" \
 *     --node-id 28
 *
 *   # single node by title:
 *   npx tsx scripts/regenerate-node.ts \
 *     --project "Письмо" \
 *     --node-title "Проза чанка"
 *
 *   # a node inside a loop, in one iteration (zero-based; a nested loop's
 *   # iteration needs the full path, e.g. --path "21:0/40:2"):
 *   npx tsx scripts/regenerate-node.ts --project "Письмо" --node-title "Проза чанка" --iteration 2
 *
 *   # entire project (every node in topological order; OUTDATED gets re-run,
 *   # GENERATED is skipped unless --regenerate-generated is set):
 *   npx tsx scripts/regenerate-node.ts --project "Письмо" --all
 *
 *   # optional (single-node mode only): refuse to start if any incoming-edge
 *   # source isn't ready (status not in {MANUAL, EMPTY, GENERATED}).
 *   npx tsx scripts/regenerate-node.ts ... --check-prereqs
 *
 * The project is migrated to the current schema first, as the app would.
 *
 * NOTE: in single-node mode, regenerateTreeNodesContents propagates stale
 * status across the graph before running, so transitively-stale upstream
 * nodes get DB-flagged OUTDATED (no LLM calls — just a status write). The
 * actual regeneration runs only for the requested node.
 */
import process from "node:process"
import { Command, InvalidArgumentError } from "commander"
import { regenerateTreeNodesContents } from "../src/backend/plan/nodes/generate/regenerateTreeNodesContents.js"
import { PlanNodeRepository } from "../src/backend/plan/nodes/plan-node-repository.js"
import { PlanNodeService } from "../src/backend/plan/nodes/plan-node-service.js"
import type { PlanNodeStateRecord } from "../src/backend/plan/nodes/plan-node-state-repository.js"
import { childPath, type NodePath, ROOT_PATH } from "../src/shared/plan-node-path.js"
import { openProject } from "./lib/project-paths.js"

interface CliArgs {
  project: string
  nodeId?: number
  nodeTitle?: string
  path?: NodePath
  iteration?: number
  all: boolean
  checkPrereqs: boolean
  printContent: boolean
}

function parseNonNegativeInt(value: string, name: string): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0) throw new InvalidArgumentError(`${name} must be a non-negative integer`)
  return n
}

function parsePositiveInt(value: string, name: string): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) throw new InvalidArgumentError(`${name} must be a positive integer`)
  return n
}

function parseCli(): CliArgs {
  const program = new Command()
    .name("regenerate-node")
    .description("Run regeneration for a single plan node, or for an entire project.")
    .requiredOption("--project <name-or-path>", "Project name (looked up in projects folder) or full path to .sqlite")
    .option("--node-id <id>", "Node ID (positive integer)", (v) => parsePositiveInt(v, "--node-id"))
    .option("--node-title <title>", "Node title (must be unique; use --node-id to disambiguate)")
    .option("--iteration <index>", "Zero-based iteration of the loop the node is in", (v) =>
      parseNonNegativeInt(v, "--iteration"),
    )
    .option("--path <path>", "The iteration as a full path, for nested loops: '21:0/40:2'")
    .option(
      "--all",
      "Regenerate every node in the project (topological order). Excludes --node-id/--node-title.",
      false,
    )
    .option(
      "--check-prereqs",
      "Single-node mode only: refuse to start if any incoming-edge source is not in {MANUAL, EMPTY, GENERATED}",
      false,
    )
    .option("--print-content", "Single-node mode only: print the regenerated node content to stdout when done", false)
    .parse()
  const opts = program.opts<{
    project: string
    nodeId?: number
    nodeTitle?: string
    path?: string
    iteration?: number
    all: boolean
    checkPrereqs: boolean
    printContent: boolean
  }>()
  if (opts.all) {
    if (opts.nodeId || opts.nodeTitle) program.error("--all cannot be combined with --node-id or --node-title.")
    if (opts.checkPrereqs) program.error("--check-prereqs only applies in single-node mode.")
    if (opts.printContent) program.error("--print-content only applies in single-node mode.")
  } else {
    if (!opts.nodeId && !opts.nodeTitle) program.error("Pass --node-id, --node-title, or --all.")
    if (opts.nodeId && opts.nodeTitle) program.error("Pass either --node-id or --node-title, not both.")
    if (opts.path !== undefined && opts.iteration !== undefined) program.error("Pass either --path or --iteration.")
  }
  return {
    project: opts.project,
    nodeId: opts.nodeId,
    nodeTitle: opts.nodeTitle,
    path: opts.path,
    iteration: opts.iteration,
    all: opts.all,
    checkPrereqs: opts.checkPrereqs,
    printContent: opts.printContent,
  }
}

function resolveNodeId(service: PlanNodeService, args: CliArgs): number {
  if (args.nodeId != null) return args.nodeId
  const all = new PlanNodeRepository().findAll()
  const matches = all.filter((n) => n.title === args.nodeTitle)
  if (matches.length === 0) {
    throw new Error(`No node with title ${JSON.stringify(args.nodeTitle)}`)
  }
  if (matches.length > 1) {
    const list = matches.map((n) => `#${n.id} (${n.type}, parent=${n.parent_id ?? "null"})`).join(", ")
    throw new Error(
      `Title ${JSON.stringify(args.nodeTitle)} is not unique — pass --node-id to disambiguate. Matches: ${list}`,
    )
  }
  void service
  return matches[0].id
}

/** Where to run the node: the given path, or the given iteration of the loop it is in. */
function resolvePath(service: PlanNodeService, nodeId: number, args: CliArgs): NodePath {
  const loops = service.loopsAround(nodeId)
  if (args.path !== undefined) return args.path
  if (loops.length === 0) {
    if (args.iteration !== undefined) throw new Error(`Node #${nodeId} is not inside a loop; drop --iteration`)
    return ROOT_PATH
  }
  if (loops.length > 1) throw new Error(`Node #${nodeId} is in nested loops; pass its iteration as --path`)
  if (args.iteration === undefined) throw new Error(`Node #${nodeId} is inside a loop; pass --iteration or --path`)
  return childPath(ROOT_PATH, loops[0], args.iteration)
}

const READY_STATUSES = new Set(["MANUAL", "EMPTY", "GENERATED"])

function assertPrerequisites(service: PlanNodeService, nodeId: number, path: NodePath): void {
  const bad: string[] = []
  for (const src of service.findInputRows(nodeId, path)) {
    if (!READY_STATUSES.has(src.status)) {
      bad.push(`  - source #${src.id} '${src.title}' (${src.type}) at "${src.path}" status=${src.status}`)
    }
  }
  if (bad.length > 0) {
    process.stderr.write(
      `Prerequisite check failed for node #${nodeId}:\n${bad.join("\n")}\n` +
        `Expected every incoming-edge source in {MANUAL, EMPTY, GENERATED}.\n`,
    )
    process.exit(1)
  }
}

/** Status counts over every node in every iteration it has run in. */
function countStatuses(states: PlanNodeStateRecord[]): string {
  const byStatus: Record<string, number> = {}
  for (const s of states) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1
  return Object.entries(byStatus)
    .map(([s, n]) => `${s}=${n}`)
    .join(", ")
}

async function main(): Promise<void> {
  const args = parseCli()
  console.info(`Opening project: ${openProject(args.project)}`)

  if (args.all) {
    const service = new PlanNodeService()
    const nodeCount = new PlanNodeRepository().count()
    console.info(
      `Whole-project regeneration: ${nodeCount} nodes — ${countStatuses(service.states.findAll())} across iterations`,
    )
    await regenerateTreeNodesContents()
    console.info(`Done. Final status counts: ${countStatuses(service.states.findAll())}`)
    return
  }

  const service = new PlanNodeService()
  const nodeId = resolveNodeId(service, args)
  const path = resolvePath(service, nodeId, args)
  const before = service.getRow(nodeId, path)
  console.info(
    `Target node: #${nodeId} '${before.title}' (${before.type}) at "${path}", status=${before.status}, ` +
      `content=${(before.content ?? "").length} chars`,
  )

  if (args.checkPrereqs) {
    assertPrerequisites(service, nodeId, path)
    console.info("Prerequisites OK.")
  }

  console.info("Regenerating…")
  await regenerateTreeNodesContents({ nodeId, path })

  const after = service.getRow(nodeId, path)
  console.info(
    `Done. status=${after.status}, content=${(after.content ?? "").length} chars` +
      (after.summary ? `, summary=${after.summary.slice(0, 80)}…` : ""),
  )

  if (args.printContent) {
    const body = after.content ?? ""
    process.stdout.write(`\n===== BEGIN CONTENT #${after.id} '${after.title}' (${after.type}) =====\n`)
    process.stdout.write(body)
    if (body.length > 0 && !body.endsWith("\n")) process.stdout.write("\n")
    process.stdout.write(`===== END CONTENT #${after.id} =====\n`)
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err)
  process.stderr.write(`${msg}\n`)
  process.exit(1)
})
