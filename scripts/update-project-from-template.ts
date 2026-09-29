#!/usr/bin/env tsx
/**
 * Update a project's plan graph from the template it was created from.
 *
 * Wraps `applyTemplateUpdate()` — same code path as the "Update from template"
 * action in the UI. Reads the template's current version on disk via the
 * project's stored `applied_template_file` setting, diffs against the project,
 * and applies: instruction rewrites on changed nodes (marked OUTDATED), new
 * nodes inserted, new input edges added. Content / status / user edits on
 * pre-existing nodes are not touched.
 *
 *   # show what would change without modifying anything
 *   npx tsx scripts/update-project-from-template.ts \
 *     --project "Гонец" \
 *     --dry-run
 *
 *   # apply
 *   npx tsx scripts/update-project-from-template.ts --project "Гонец"
 *
 *   # apply, and also drop edges the template no longer declares
 *   npx tsx scripts/update-project-from-template.ts --project "Гонец" --remove-missing-edges
 *
 * Title-based diffing has a known gap: a renamed-in-template node looks like
 * 'deleted old + added new' to this tool — the old project node stays as an
 * orphan, the new one gets inserted. Handle that case manually.
 */
import { Command } from "commander"
import { setCurrentDbPath } from "../src/backend/db/state.js"
import { analyzeTemplateUpdate, applyTemplateUpdate } from "../src/backend/projects/template-update.js"
import { openProject } from "./lib/project-paths.js"

interface CliArgs {
  project: string
  dryRun: boolean
  removeMissingEdges: boolean
}

function parseCli(): CliArgs {
  const program = new Command()
    .name("update-project-from-template")
    .description("Update a project's plan graph from the template it was created from.")
    .requiredOption("--project <name-or-path>", "Project name (looked up in projects folder) or full path to .sqlite")
    .option("--dry-run", "Show what would change without modifying anything", false)
    .option(
      "--remove-missing-edges",
      "Also delete edges the project has and the template no longer declares (off by default)",
      false,
    )
    .parse()
  return program.opts<CliArgs>()
}

function printAnalysis(analysis: ReturnType<typeof analyzeTemplateUpdate>): void {
  console.info(`Template: ${analysis.templateFile}`)
  console.info(`Unchanged nodes: ${analysis.unchangedCount}`)
  if (analysis.updatedNodes.length > 0) {
    console.info(`Updated nodes (${analysis.updatedNodes.length}) — instruction fields will be rewritten:`)
    for (const n of analysis.updatedNodes) console.info(`  - ${n.title} (${n.type})`)
  } else {
    console.info("Updated nodes: 0")
  }
  if (analysis.retypedNodes.length > 0) {
    console.info(`Nodes changing kind (${analysis.retypedNodes.length}) — what they produced is kept:`)
    for (const n of analysis.retypedNodes) console.info(`  - ${n.title}: ${n.from} → ${n.to}`)
  }
  for (const n of analysis.retypeBlocked) {
    console.info(`Cannot change the kind of ${n.title} (${n.from} → ${n.to}): ${n.reason}`)
  }
  if (analysis.newNodes.length > 0) {
    console.info(`New nodes (${analysis.newNodes.length}) — will be inserted:`)
    for (const n of analysis.newNodes) console.info(`  - ${n.title} (${n.type})`)
  } else {
    console.info("New nodes: 0")
  }
  if (analysis.newEdges.length > 0) {
    console.info(`New edges (${analysis.newEdges.length}) — will be inserted:`)
    for (const e of analysis.newEdges) console.info(`  - ${e.sourceTitle} → ${e.targetTitle} [${e.type}]`)
  } else {
    console.info("New edges: 0")
  }
  if (analysis.removedEdges.length > 0) {
    console.info(
      `Edges no longer in the template (${analysis.removedEdges.length}) — kept unless --remove-missing-edges:`,
    )
    for (const e of analysis.removedEdges) console.info(`  - ${e.sourceTitle} → ${e.targetTitle} [${e.type}]`)
  } else {
    console.info("Edges no longer in the template: 0")
  }
}

async function main(): Promise<void> {
  const args = parseCli()
  console.info(`Opening project: ${openProject(args.project)}`)

  const analysis = analyzeTemplateUpdate()
  printAnalysis(analysis)

  if (args.dryRun) {
    console.info("\n--dry-run: nothing was modified.")
    setCurrentDbPath(null)
    return
  }

  const removableEdges = args.removeMissingEdges ? analysis.removedEdges.length : 0
  if (
    analysis.updatedNodes.length === 0 &&
    analysis.retypedNodes.length === 0 &&
    analysis.newNodes.length === 0 &&
    analysis.newEdges.length === 0 &&
    removableEdges === 0
  ) {
    console.info("\nProject is already in sync with the template — nothing to apply.")
    setCurrentDbPath(null)
    return
  }

  console.info("\nApplying…")
  const result = await applyTemplateUpdate({ removeMissingEdges: args.removeMissingEdges })
  console.info(
    `Applied at ${result.appliedAt}: ${result.retypedNodeCount} change(s) of kind, ` +
      `${result.updatedNodeCount} instruction rewrite(s), ` +
      `${result.newNodeCount} new node(s), ${result.newEdgeCount} new edge(s), ` +
      `${result.removedEdgeCount} edge(s) removed.`,
  )
  setCurrentDbPath(null)
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err)
  process.stderr.write(`${msg}\n`)
  process.exit(1)
})
