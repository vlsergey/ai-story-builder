#!/usr/bin/env tsx
/**
 * Switch which iteration is currently "mounted" on a for-each container.
 *
 * Mirrors what the page-switcher arrow buttons do in the UI: saves the
 * current iteration's child contents into `overrides[currentIndex]`, then
 * loads `overrides[targetIndex]` back into the live child rows. Use this
 * before re-running `regenerate-node.ts` on a child of a for-each — the
 * scheduler always operates on the currently-mounted iteration.
 *
 *   npx tsx scripts/switch-foreach-iteration.ts \
 *     --project "Письмо" \
 *     --node-id 21 \
 *     --iteration 0
 *
 *   # by title:
 *   npx tsx scripts/switch-foreach-iteration.ts \
 *     --project "Письмо" \
 *     --node-title "Цикл по чанкам" \
 *     --iteration 2
 *
 * Iteration index is zero-based: pass 0 for the first iteration.
 */
import process from "node:process"
import { Command, InvalidArgumentError } from "commander"
import { setCurrentDbPath } from "../src/backend/db/state.js"
import { PlanNodeRepository } from "../src/backend/plan/nodes/plan-node-repository.js"
import { PlanNodeService } from "../src/backend/plan/nodes/plan-node-service.js"
import type { ForEachNodeContent } from "../src/shared/for-each-plan-node.js"
import { resolveProjectPath } from "./lib/project-paths.js"

interface CliArgs {
  project: string
  nodeId?: number
  nodeTitle?: string
  iteration: number
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
    .name("switch-foreach-iteration")
    .description("Switch which iteration is currently mounted on a for-each container.")
    .requiredOption("--project <name-or-path>", "Project name (looked up in projects folder) or full path to .sqlite")
    .option("--node-id <id>", "For-each node ID (positive integer)", (v) => parsePositiveInt(v, "--node-id"))
    .option("--node-title <title>", "For-each node title (must be unique; use --node-id to disambiguate)")
    .requiredOption("--iteration <index>", "Zero-based iteration index to mount", (v) =>
      parseNonNegativeInt(v, "--iteration"),
    )
    .parse()
  const opts = program.opts<{ project: string; nodeId?: number; nodeTitle?: string; iteration: number }>()
  if (!opts.nodeId && !opts.nodeTitle) program.error("Pass --node-id or --node-title")
  if (opts.nodeId && opts.nodeTitle) program.error("Pass either --node-id or --node-title, not both.")
  return {
    project: opts.project,
    nodeId: opts.nodeId,
    nodeTitle: opts.nodeTitle,
    iteration: opts.iteration,
  }
}

function resolveNodeId(args: CliArgs): number {
  if (args.nodeId != null) return args.nodeId
  const all = new PlanNodeRepository().findAll()
  const matches = all.filter((n) => n.title === args.nodeTitle)
  if (matches.length === 0) throw new Error(`No node with title ${JSON.stringify(args.nodeTitle)}`)
  if (matches.length > 1) {
    const list = matches.map((n) => `#${n.id} (${n.type})`).join(", ")
    throw new Error(`Title ${JSON.stringify(args.nodeTitle)} is not unique — pass --node-id. Matches: ${list}`)
  }
  return matches[0].id
}

function main(): void {
  const args = parseCli()
  const dbPath = resolveProjectPath(args.project)
  console.info(`Opening project: ${dbPath}`)
  setCurrentDbPath(dbPath)

  const service = new PlanNodeService()
  const nodeId = resolveNodeId(args)
  const node = service.getById(nodeId)
  if (node.type !== "for-each") {
    throw new Error(`Node #${nodeId} '${node.title}' is type '${node.type}', not 'for-each'`)
  }

  const parsed = JSON.parse(node.content || "{}") as ForEachNodeContent
  const total = parsed.length ?? (parsed.overrides?.length || 0)
  if (args.iteration >= total) {
    throw new Error(
      `Iteration ${args.iteration} is out of range for for-each #${nodeId} '${node.title}' ` +
        `(has ${total} iteration${total === 1 ? "" : "s"} — valid indices 0..${total - 1})`,
    )
  }

  const before = parsed.currentIndex ?? 0
  console.info(`For-each #${nodeId} '${node.title}': currentIndex ${before} → ${args.iteration} (of ${total})`)

  service.changeForEachNodePage(nodeId, args.iteration)
  console.info("Switched.")
}

try {
  main()
} catch (err) {
  const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err)
  process.stderr.write(`${msg}\n`)
  process.exit(1)
}
