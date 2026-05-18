#!/usr/bin/env tsx
/**
 * Dump every for-each iteration whose final-polish node is GENERATED into a
 * single Markdown file. Use while a long project regen is still running, to
 * preview chunks as they get polished without waiting for the whole thing.
 *
 *   npx tsx scripts/export-ready-chunks.ts \
 *     --project "В баре" \
 *     --output "examples/В баре.partial.md"
 *
 *   # custom polish node title (default: "Полировка: голос и стиль"):
 *   npx tsx scripts/export-ready-chunks.ts \
 *     --project "В баре" \
 *     --polish-node "Polish: voice & style"
 *
 *   # custom for-each container (default: "Цикл по чанкам"):
 *   npx tsx scripts/export-ready-chunks.ts \
 *     --project "В баре" \
 *     --for-each "Per-chunk loop"
 *
 * Iterations that aren't GENERATED yet appear as placeholder headers
 * `## Часть N — <STATUS>` so the file shows progress at a glance.
 *
 * Read-only: doesn't run any regeneration; doesn't mutate the project DB.
 */
import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import Database from "better-sqlite3"
import { Command } from "commander"
import { resolveProjectPath } from "./lib/project-paths.js"

interface CliArgs {
  project: string
  forEach: string
  polishNode: string
  output?: string
}

function parseCli(): CliArgs {
  return new Command()
    .name("export-ready-chunks")
    .description("Dump polished for-each iterations to a Markdown file as they become GENERATED.")
    .requiredOption("--project <name-or-path>", "Project name (looked up in projects folder) or full path to .sqlite")
    .option("--for-each <title>", "For-each container title", "Цикл по чанкам")
    .option("--polish-node <title>", "Final polish node title inside the for-each", "Полировка: голос и стиль")
    .option("--output <path>", "Write to this file. If omitted, prints to stdout.")
    .parse()
    .opts<CliArgs>()
}

interface OverrideSlot {
  status?: string
  content?: string
}
interface ForEachContent {
  currentIndex?: number
  length?: number
  overrides?: Array<Record<string, OverrideSlot>>
}

function main(): void {
  const args = parseCli()
  const dbPath = resolveProjectPath(args.project)
  const db = new Database(dbPath, { readonly: true })
  try {
    const containerRow = db
      .prepare("SELECT id, content FROM plan_nodes WHERE title = ?")
      .get(args.forEach) as { id: number; content: string | null } | undefined
    if (!containerRow) throw new Error(`for-each container '${args.forEach}' not found`)
    const polishRow = db
      .prepare("SELECT id, status, content FROM plan_nodes WHERE title = ?")
      .get(args.polishNode) as { id: number; status: string; content: string | null } | undefined
    if (!polishRow) throw new Error(`polish node '${args.polishNode}' not found`)

    const parsed = JSON.parse(containerRow.content || "{}") as ForEachContent
    const total = parsed.length ?? parsed.overrides?.length ?? 0
    const currentIndex = parsed.currentIndex ?? 0
    if (total === 0) throw new Error("for-each has no iterations to export")

    const parts: string[] = []
    let readyCount = 0
    for (let i = 0; i < total; i++) {
      let status: string
      let content: string
      if (i === currentIndex) {
        status = polishRow.status
        content = polishRow.content ?? ""
      } else {
        const slot = parsed.overrides?.[i]?.[String(polishRow.id)]
        status = slot?.status ?? "EMPTY"
        content = slot?.content ?? ""
      }
      if (status === "GENERATED" && content.trim().length > 0) {
        parts.push(content.trim())
        readyCount++
      } else {
        parts.push(`## Часть ${i + 1} — ${status}`)
      }
    }

    const header =
      `<!-- Partial export — ${readyCount}/${total} chunks polished as of ${new Date().toISOString()} -->\n` +
      `<!-- Project: ${path.basename(dbPath)} -->\n\n`
    const body = parts.join("\n\n")

    if (args.output) {
      fs.writeFileSync(args.output, header + body + "\n", "utf8")
      process.stderr.write(`Wrote ${readyCount}/${total} chunks to ${args.output}\n`)
    } else {
      process.stdout.write(header + body + "\n")
      process.stderr.write(`\n${readyCount}/${total} chunks ready.\n`)
    }
  } finally {
    db.close()
  }
}

main()
