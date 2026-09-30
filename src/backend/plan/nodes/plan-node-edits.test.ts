import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { getCurrentDb } from "../../db/state.js"
import { setUpTestDb, tearDownTestDb } from "../../db/test-db-utils.js"
import { createGraphEdge } from "../edges/plan-edge-routes.js"
import { seedEdge, seedNode, stateAt } from "./plan-node-fixtures.js"
import { PlanNodeService } from "./plan-node-service.js"

/** What editors and routes may do to a node, and what they are refused. */
describe("editing a node through the service", () => {
  beforeEach(() => setUpTestDb())
  afterEach(() => tearDownTestDb())

  const prompt = (text: string) => JSON.stringify({ userPrompt: text })

  it("saves a new prompt and the text typed with it in one save, checked against what the editor read", async () => {
    const service = new PlanNodeService()
    const a = seedNode({ title: "A", at: { "": { status: "MANUAL", content: "hello" } } })
    const b = seedNode({
      title: "B",
      settings: prompt("Echo {{[A]}}"),
      at: { "": { status: "GENERATED", content: "x" } },
    })
    seedEdge(a, b)
    const read = service.getRow(b, "")

    await service.patch(b, "", true, { node_type_settings: prompt("New {{[A]}}"), content: "my text" }, read.rev)

    const after = service.getRow(b, "")
    expect(after.node_type_settings).toBe(prompt("New {{[A]}}"))
    expect(after.content).toBe("my text")
    expect(after.status).toBe("MANUAL")
  })

  it("refuses to move a node and write its state in one save", async () => {
    const service = new PlanNodeService()
    const loop = service.create({ title: "Loop", type: "for-each" }).id
    const node = service.create({ title: "Note", type: "text" }).id

    await expect(service.patch(node, "", true, { parent_id: loop, content: "text" })).rejects.toThrow()
    expect(service.getDefinition(node).parent_id).toBeNull()
  })

  it("keeps an iteration pending when only a note is written to it", async () => {
    const service = new PlanNodeService()
    const loop = seedNode({
      title: "Loop",
      type: "for-each",
      at: { "": { status: "GENERATED", content: '{"length":1}' } },
    })
    const child = seedNode({ title: "Child", parent: loop, settings: prompt("Write.") })

    await service.patch(child, `${loop}:0`, true, { ai_improve_instruction: "shorter" })

    expect(stateAt(child, `${loop}:0`)?.status).toBe("OUTDATED")
  })

  it("refuses an iteration written in a way the loop never names it", async () => {
    const service = new PlanNodeService()
    const loop = seedNode({
      title: "Loop",
      type: "for-each",
      at: { "": { status: "GENERATED", content: '{"length":2}' } },
    })
    const child = seedNode({ title: "Child", parent: loop })

    for (const key of ["01", "-1", "1.0", " 1", "2"]) {
      await expect(service.patch(child, `${loop}:${key}`, true, { content: "x" }), key).rejects.toThrow()
    }
    await service.patch(child, `${loop}:1`, true, { content: "x" })
    expect(stateAt(child, `${loop}:1`)?.content).toBe("x")
  })

  it("does not hang on a node that is its own ancestor", () => {
    const service = new PlanNodeService()
    const a = seedNode({ title: "A" })
    const b = seedNode({ title: "B", parent: a })
    getCurrentDb().pragma("foreign_keys = OFF")
    getCurrentDb().prepare("UPDATE plan_nodes SET parent_id = ? WHERE id = ?").run(b, a)

    expect(() => service.loopsAround(b)).not.toThrow()
  })

  it("refuses an edge from a loop into its own iterations", () => {
    const service = new PlanNodeService()
    const loop = service.create({ title: "Loop", type: "for-each" }).id
    const merge = service.create({ title: "Merge", type: "merge", parent_id: loop }).id

    expect(() => createGraphEdge({ from_node_id: loop, to_node_id: merge, type: "textArray" })).toThrow(/loop/)
  })
})
