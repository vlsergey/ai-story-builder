import fs from "node:fs"
import path from "node:path"
import * as DbState from "../src/backend/db/state.js"
import { PlanNodeRepository } from "../src/backend/plan/nodes/plan-node-repository.js"
import { PlanNodeService } from "../src/backend/plan/nodes/plan-node-service.js"

DbState.setCurrentDbPath(null)
DbState.setCurrentDbPath(path.resolve(".run/story.sqlite"))

const OUT = path.resolve(".run/real")
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

const svc = new PlanNodeService()
for (const node of new PlanNodeRepository().findAll()) {
  const proc = svc.getProcessor(node.type)
  let out: unknown = node.content
  try {
    out = proc?.getOutput(svc, node) ?? node.content
  } catch {
    /* оставляем content */
  }
  const text = typeof out === "string" ? out : JSON.stringify(out, null, 1)
  const safe = `${String(node.id).padStart(3, "0")}-${node.title.replace(/[^\p{L}\p{N} -]/gu, "").slice(0, 46)}`
  fs.writeFileSync(path.join(OUT, `${safe}.md`), text ?? "")
  console.log(
    `${String(node.id).padStart(3)} ${node.type.padEnd(14)} ${node.title.slice(0, 40).padEnd(42)} ${String(text?.length ?? 0).padStart(7)}`,
  )
}
