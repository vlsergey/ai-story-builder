/**
 * Возобновление прогона по уже существующей базе.
 * Перегенерируются только узлы в ERROR / OUTDATED / EMPTY — GENERATED не трогаются.
 *   npx tsx .run/resume.ts [maxOutputTokens]
 */
import fs from "node:fs"
import path from "node:path"
import * as DbState from "../src/backend/db/state.js"
import {
  regenerateTreeNodesContents,
  subscribeToStatusEvents,
} from "../src/backend/plan/nodes/generate/regenerateTreeNodesContents.js"
import { PlanNodeRepository } from "../src/backend/plan/nodes/plan-node-repository.js"
import { SettingsRepository } from "../src/backend/settings/settings-repository.js"
import { SettingsMap } from "../src/shared/settings.js"

const MAX_TOKENS = Number(process.argv[2] ?? 6000)
const DB = path.resolve(".run/story.sqlite")
if (!fs.existsSync(DB)) throw new Error(`нет базы: ${DB}`)

DbState.setCurrentDbPath(null)
DbState.setCurrentDbPath(DB)

// Единственная правка настроек: потолок вывода. Без него локальная модель
// уходит в разгон внутри строки JSON и обрывается по контексту.
const cfg = SettingsRepository.get(SettingsMap.allAiEnginesConfig) as any
cfg.ollama.defaultAiGenerationSettings.max_output_tokens = MAX_TOKENS
SettingsRepository.set(SettingsMap.allAiEnginesConfig, cfg)

const repo = new PlanNodeRepository()
const all = repo.findAll()
const todo = all.filter((n) => ["ERROR", "OUTDATED", "EMPTY"].includes(n.status))
console.error(`RESUME потолок=${MAX_TOKENS} доделать=${todo.length} из ${all.length}`)
for (const n of todo) console.error(`  TODO ${n.status.padEnd(9)} ${n.title}`)

const t0 = Date.now()
let last = ""
subscribeToStatusEvents().subscribe({
  next: (e: any) => {
    const cur =
      e?.currentRegenerationStack
        ?.map((s: any) => s?.node?.title)
        .filter(Boolean)
        .join(" / ") ?? ""
    if (cur && cur !== last) {
      last = cur
      console.error(`PROGRESS ${((Date.now() - t0) / 1000).toFixed(0)}s ${cur}`)
    }
  },
  error: () => {},
  complete: () => {},
})

try {
  await regenerateTreeNodesContents(undefined)
  console.error(`DONE ${((Date.now() - t0) / 60000).toFixed(1)} мин`)
} catch (err) {
  console.error(`FAILED ${err instanceof Error ? err.message : String(err)}`)
} finally {
  const after = repo.findAll()
  const bad = after.filter((n) => n.status !== "GENERATED" && n.status !== "MANUAL")
  console.error(`RESULT незакрытых=${bad.length}`)
  for (const n of bad) console.error(`  ${n.status.padEnd(9)} ${n.title}`)
}
