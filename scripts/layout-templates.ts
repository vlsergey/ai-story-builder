#!/usr/bin/env tsx
/**
 * Recompute x/y/width/height of every plan node in every bundled template by
 * running them through the same ELK "layered" layout the frontend uses. Writes
 * the results back to the template files in place.
 *
 * Run:    npx tsx scripts/layout-templates.ts [file.json [file.json ...]]
 * No args: processes every *.json under src/backend/resources/resources/templates/.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { computeTemplateLayoutWithEntries } from "../src/backend/lib/elk-template-layout.js"
import type { ProjectTemplate } from "../src/shared/project-template.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = path.resolve(__dirname, "../src/backend/resources/resources/templates")

async function layoutTemplate(filePath: string): Promise<{ moved: number; total: number }> {
  const raw = readFileSync(filePath, "utf8")
  const template = JSON.parse(raw) as ProjectTemplate

  const entries = await computeTemplateLayoutWithEntries(template)

  let moved = 0
  for (const { node, expected } of entries) {
    const oldX = node.x ?? 0
    const oldY = node.y ?? 0
    const oldW = node.width
    const oldH = node.height
    if (expected.x !== oldX || expected.y !== oldY || expected.width !== oldW || expected.height !== oldH) moved++
    node.x = expected.x
    node.y = expected.y
    node.width = expected.width
    node.height = expected.height
  }

  writeFileSync(filePath, `${JSON.stringify(template, null, 2)}\n`, "utf8")
  return { moved, total: entries.length }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const files =
    args.length > 0
      ? args.map((a) => path.resolve(process.cwd(), a))
      : readdirSync(TEMPLATES_DIR)
          .filter((f) => f.endsWith(".json"))
          .map((f) => path.join(TEMPLATES_DIR, f))

  if (files.length === 0) {
    console.warn("No templates found.")
    return
  }

  for (const file of files) {
    const { moved, total } = await layoutTemplate(file)
    console.log(`${path.relative(process.cwd(), file)} — ${moved}/${total} nodes updated`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
