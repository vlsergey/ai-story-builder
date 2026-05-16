#!/usr/bin/env tsx
/**
 * Print a single plan node's stored content from a project sqlite to stdout.
 *
 * Read-only: doesn't run regeneration, doesn't touch the graph. Useful for
 * inspecting what's already in the DB — after a manual edit, after a
 * regenerate-node run, or just to compare the same node across projects.
 *
 *   npx tsx scripts/dump-node.ts --project "Письмо" --node-title "Мир"
 *   npx tsx scripts/dump-node.ts --project "Письмо" --node-id 2
 *
 * By default prints a metadata header on stderr and the content on stdout,
 * so you can pipe just the body somewhere (`> mir.txt`) while still seeing
 * the header in the terminal. Pass --quiet to suppress the header.
 */
import process from "node:process"
import { parseArgs } from "node:util"
import { setCurrentDbPath } from "../src/backend/db/state.js"
import { PlanNodeRepository } from "../src/backend/plan/nodes/plan-node-repository.js"
import { resolveProjectPath } from "./lib/project-paths.js"

interface CliArgs {
  project: string
  nodeId?: number
  nodeTitle?: string
  quiet: boolean
}

function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      project: { type: "string" },
      "node-id": { type: "string" },
      "node-title": { type: "string" },
      quiet: { type: "boolean", default: false },
    },
  })
  if (!values.project || (!values["node-id"] && !values["node-title"])) {
    process.stderr.write(
      "usage: tsx scripts/dump-node.ts " +
        "--project <name-or-path> " +
        "(--node-id <n> | --node-title <title>) " +
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
  return {
    project: values.project as string,
    nodeId,
    nodeTitle: values["node-title"],
    quiet: !!values.quiet,
  }
}

function main(): void {
  const args = parseCli()
  const dbPath = resolveProjectPath(args.project)
  setCurrentDbPath(dbPath)

  const repo = new PlanNodeRepository()
  let node: ReturnType<typeof repo.findAll>[number] | undefined
  if (args.nodeId != null) {
    node = repo.findAll().find((n) => n.id === args.nodeId)
    if (!node) throw new Error(`No node with id ${args.nodeId} in ${dbPath}`)
  } else {
    const matches = repo.findAll().filter((n) => n.title === args.nodeTitle)
    if (matches.length === 0) throw new Error(`No node with title ${JSON.stringify(args.nodeTitle)} in ${dbPath}`)
    if (matches.length > 1) {
      const list = matches.map((n) => `#${n.id} (${n.type})`).join(", ")
      throw new Error(`Title ${JSON.stringify(args.nodeTitle)} is not unique — pass --node-id. Matches: ${list}`)
    }
    node = matches[0]
  }

  const content = node.content ?? ""
  if (!args.quiet) {
    process.stderr.write(
      `===== ${args.project} / #${node.id} '${node.title}' (${node.type}) / ${node.status} / ${content.length} chars =====\n`,
    )
  }
  process.stdout.write(content)
  if (content.length > 0 && !content.endsWith("\n")) process.stdout.write("\n")
}

try {
  main()
} catch (err) {
  const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err)
  process.stderr.write(`${msg}\n`)
  process.exit(1)
}
