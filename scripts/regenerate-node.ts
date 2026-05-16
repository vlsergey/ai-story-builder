#!/usr/bin/env tsx
/**
 * Run regeneration for a single plan node inside a project sqlite.
 *
 * Wraps `regenerateTreeNodesContents(nodeId)` — the same path the UI's
 * "regenerate this node" button uses. Works for any node type the engine
 * knows how to regenerate (text/split/merge/fix-problems/for-each/lore);
 * not strictly LLM-only.
 *
 *   npx tsx scripts/regenerate-node.ts \
 *     --project "Письмо" \
 *     --node-id 28
 *
 *   # or by title:
 *   npx tsx scripts/regenerate-node.ts \
 *     --project "Письмо" \
 *     --node-title "Проза чанка"
 *
 *   # optional: refuse to start if any incoming-edge source isn't ready
 *   #   (status not in {MANUAL, EMPTY, GENERATED}). Useful when you don't
 *   #   want to trigger a cascade — exit early instead.
 *   npx tsx scripts/regenerate-node.ts ... --check-prereqs
 *
 * NOTE: regenerateTreeNodesContents propagates stale status across the
 * graph before running, so transitively-stale upstream nodes get DB-flagged
 * OUTDATED (no LLM calls — just a status write). The actual regeneration
 * runs only for the requested node.
 */
import process from "node:process"
import { parseArgs } from "node:util"
import { setCurrentDbPath } from "../src/backend/db/state.js"
import { PlanEdgeRepository } from "../src/backend/plan/edges/plan-edge-repository.js"
import { regenerateTreeNodesContents } from "../src/backend/plan/nodes/generate/regenerateTreeNodesContents.js"
import { PlanNodeRepository } from "../src/backend/plan/nodes/plan-node-repository.js"
import { PlanNodeService } from "../src/backend/plan/nodes/plan-node-service.js"
import { resolveProjectPath } from "./lib/project-paths.js"

interface CliArgs {
  project: string
  nodeId?: number
  nodeTitle?: string
  checkPrereqs: boolean
  printContent: boolean
}

function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      project: { type: "string" },
      "node-id": { type: "string" },
      "node-title": { type: "string" },
      "check-prereqs": { type: "boolean", default: false },
      "print-content": { type: "boolean", default: false },
    },
  })
  if (!values.project || (!values["node-id"] && !values["node-title"])) {
    process.stderr.write(
      "usage: tsx scripts/regenerate-node.ts " +
        "--project <name-or-path> " +
        "(--node-id <n> | --node-title <title>) " +
        "[--check-prereqs] [--print-content]\n",
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
  return {
    project: values.project as string,
    nodeId,
    nodeTitle: values["node-title"],
    checkPrereqs: !!values["check-prereqs"],
    printContent: !!values["print-content"],
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

const READY_STATUSES = new Set(["MANUAL", "EMPTY", "GENERATED"])

function assertPrerequisites(service: PlanNodeService, nodeId: number): void {
  const incoming = new PlanEdgeRepository().findByToNodeId(nodeId)
  const bad: string[] = []
  for (const edge of incoming) {
    const src = service.getById(edge.from_node_id)
    if (!READY_STATUSES.has(src.status)) {
      bad.push(`  - source #${src.id} '${src.title}' (${src.type}) status=${src.status}`)
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

async function main(): Promise<void> {
  const args = parseCli()
  const dbPath = resolveProjectPath(args.project)
  console.info(`Opening project: ${dbPath}`)
  setCurrentDbPath(dbPath)

  const service = new PlanNodeService()
  const nodeId = resolveNodeId(service, args)
  const before = service.getById(nodeId)
  console.info(
    `Target node: #${nodeId} '${before.title}' (${before.type}, status=${before.status}, ` +
      `content=${(before.content ?? "").length} chars)`,
  )

  if (args.checkPrereqs) {
    assertPrerequisites(service, nodeId)
    console.info("Prerequisites OK.")
  }

  console.info("Regenerating…")
  await regenerateTreeNodesContents(nodeId)

  const after = service.getById(nodeId)
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
