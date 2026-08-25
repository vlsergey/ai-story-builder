/**
 * Безголовый прогон шаблона на локальной модели.
 *   npx tsx .run/run-template.ts [chunksCount]
 * База в .run/story.sqlite, узлы в .run/out/.
 */
import fs from "node:fs"
import path from "node:path"
import { migrateDatabase } from "../src/backend/db/migrations.js"
import * as DbState from "../src/backend/db/state.js"
import {
  regenerateTreeNodesContents,
  subscribeToStatusEvents,
} from "../src/backend/plan/nodes/generate/regenerateTreeNodesContents.js"
import { PlanNodeRepository } from "../src/backend/plan/nodes/plan-node-repository.js"
import { applyProjectTemplate } from "../src/backend/projects/apply-project-template.js"
import { SettingsRepository } from "../src/backend/settings/settings-repository.js"
import { SettingsMap } from "../src/shared/settings.js"

const CHUNKS = Number(process.argv[2] ?? 3)
const MODEL = "huihui_ai/qwen3.8-abliterated:27b-q3_K"
const ROOT = path.resolve(".run")
const DB = path.join(ROOT, "story.sqlite")
const OUT = path.join(ROOT, "out")

const SYNOPSIS = `Брат, 23 года, выставляет сестру, 21 год, на балкон в одном полотенце и
запирает дверь. Он требует, чтобы она спустилась по вертикальной пожарной лестнице, обошла
дом и вернулась через подъезд. Пока она спускается, ветер уносит полотенце далеко во двор.
Код от подъезда не подходит, и ей приходится говорить с братом через домофон.`

// Чистим только то, что сами породили: скрипт лежит здесь же.
fs.rmSync(OUT, { recursive: true, force: true })
fs.rmSync(DB, { force: true })
fs.mkdirSync(OUT, { recursive: true })

DbState.setCurrentDbPath(null)
DbState.setCurrentDbPath(DB)
migrateDatabase(DbState.getCurrentDb())

SettingsRepository.set(SettingsMap.currentBackend, "ollama")
SettingsRepository.set(SettingsMap.allAiEnginesConfig, {
  ollama: {
    base_url: "http://localhost:11434",
    available_models: [MODEL],
    defaultAiGenerationSettings: {
      model: MODEL,
      num_ctx: 65536,
      temperature: 1,
      think: false,
      max_output_tokens: 0,
    },
  },
})
SettingsRepository.set(SettingsMap.autoGenerateSummary, false)

const template = JSON.parse(fs.readFileSync("src/backend/resources/resources/templates/fiction-arc.ru.json", "utf8"))
applyProjectTemplate(template, { ageRating: "18+", synopsis: SYNOPSIS, chunksCount: String(CHUNKS) })

// Песочница: у fix-problems режем цикл до одной итерации. Шаблон не трогаем —
// там числа подобраны под нормальную модель; здесь важно пройти граф, а не отполировать.
{
  const repo0 = new PlanNodeRepository()
  let capped = 0
  for (const n of repo0.findAll()) {
    if (n.type !== "fix-problems" || !n.node_type_settings) continue
    const s = JSON.parse(n.node_type_settings)
    if ((s.maxIterations ?? 1) > 1) {
      s.maxIterations = 1
      repo0.patch(n.id, { node_type_settings: JSON.stringify(s) })
      capped++
    }
  }
  console.error(`CAP итераций срезано у ${capped} узлов`)
}

const repo = new PlanNodeRepository()
const total = repo.findAll().length
console.error(`START узлов=${total} чанков=${CHUNKS} модель=${MODEL}`)

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
  let filled = 0
  for (const node of repo.findAll()) {
    const safe = `${String(node.id).padStart(3, "0")}-${node.title.replace(/[^\p{L}\p{N} -]/gu, "").slice(0, 46)}`
    fs.writeFileSync(
      path.join(OUT, `${safe}.md`),
      `# ${node.title}\n\nстатус: ${node.status}\n\n---\n\n${node.content ?? ""}\n`,
    )
    if (node.content) filled++
  }
  console.error(`RESULT заполнено=${filled} из=${total}`)
}
