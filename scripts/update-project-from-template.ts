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
 * Title-based diffing has a known gap: a renamed-in-template node looks like
 * 'deleted old + added new' to this tool — the old project node stays as an
 * orphan, the new one gets inserted. Handle that case manually.
 */
import process from "node:process"
import { parseArgs } from "node:util"
import { setCurrentDbPath } from "../src/backend/db/state.js"
import { analyzeTemplateUpdate, applyTemplateUpdate } from "../src/backend/projects/template-update.js"
import { resolveProjectPath } from "./lib/project-paths.js"

interface CliArgs {
  project: string
  dryRun: boolean
}

function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      project: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  })
  if (!values.project) {
    process.stderr.write("usage: tsx scripts/update-project-from-template.ts --project <name-or-path> [--dry-run]\n")
    process.exit(2)
  }
  return {
    project: values.project,
    dryRun: !!values["dry-run"],
  }
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
}

async function main(): Promise<void> {
  const args = parseCli()
  const dbPath = resolveProjectPath(args.project)
  console.info(`Opening project: ${dbPath}`)
  setCurrentDbPath(dbPath)

  const analysis = analyzeTemplateUpdate()
  printAnalysis(analysis)

  if (args.dryRun) {
    console.info("\n--dry-run: nothing was modified.")
    setCurrentDbPath(null)
    return
  }

  if (analysis.updatedNodes.length === 0 && analysis.newNodes.length === 0 && analysis.newEdges.length === 0) {
    console.info("\nProject is already in sync with the template — nothing to apply.")
    setCurrentDbPath(null)
    return
  }

  console.info("\nApplying…")
  const result = await applyTemplateUpdate()
  console.info(
    `Applied at ${result.appliedAt}: ${result.updatedNodeCount} instruction rewrite(s), ` +
      `${result.newNodeCount} new node(s), ${result.newEdgeCount} new edge(s).`,
  )
  setCurrentDbPath(null)
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err)
  process.stderr.write(`${msg}\n`)
  process.exit(1)
})
