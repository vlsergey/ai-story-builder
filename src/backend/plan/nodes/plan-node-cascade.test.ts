import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { PlanNodeStatus } from "../../../shared/plan-graph.js"
import { setUpTestDb, tearDownTestDb } from "../../db/test-db-utils.js"
import { PlanEdgeRepository } from "../edges/plan-edge-repository.js"
import { PlanNodeRepository } from "./plan-node-repository.js"
import { PlanNodeService } from "./plan-node-service.js"

/**
 * What a patch of X does to X's consumers, through
 * `markAsOutdatedAndNotifyDownstreamNodes`.
 */
describe("the cascade from a patch", () => {
  beforeEach(() => setUpTestDb())
  afterEach(() => tearDownTestDb())

  const repo = () => new PlanNodeRepository()

  /** X → Y, where Y's prompt reads X unless told otherwise. */
  function graph(consumer: { status: PlanNodeStatus; prompt?: string }) {
    const x = repo().insert({ title: "Черновик мира", type: "text", status: "GENERATED", content: "old" })
    const y = repo().insert({
      title: "Мир",
      type: "text",
      status: consumer.status,
      content: "generated from old",
      node_type_settings: JSON.stringify({ userPrompt: consumer.prompt ?? "Проверь:\n{{[Черновик мира]}}" }),
    })
    new PlanEdgeRepository().insert({ from_node_id: x, to_node_id: y, type: "text" })
    return { x, y }
  }

  const statusOf = (id: number) => repo().findById(id)!.status

  it("demotes a consumer whose prompt reads the input", async () => {
    const { x, y } = graph({ status: "GENERATED" })
    await new PlanNodeService().patch(x, true, { content: "new" })
    expect(statusOf(y)).toBe("OUTDATED")
  })

  it("reaches consumers when an improve changes content together with review fields", async () => {
    const { x, y } = graph({ status: "GENERATED" })
    await new PlanNodeService().patch(x, true, { content: "improved", in_review: 1, review_base_content: "old" })
    expect(statusOf(y)).toBe("OUTDATED")
  })

  it("leaves consumers alone when the content is rewritten unchanged", async () => {
    const { x, y } = graph({ status: "GENERATED" })
    await new PlanNodeService().patch(x, false, { content: "old" })
    expect(statusOf(y)).toBe("GENERATED")
  })

  it("leaves consumers alone when a node merely starts generating", async () => {
    const { x, y } = graph({ status: "GENERATED" })
    await new PlanNodeService().patch(x, false, { status: "GENERATING" })
    expect(statusOf(y)).toBe("GENERATED")
  })

  it("leaves a consumer whose prompt does not read the changed input", async () => {
    const { x, y } = graph({ status: "GENERATED", prompt: "Напиши что-нибудь без входов" })
    await new PlanNodeService().patch(x, true, { content: "new" })
    expect(statusOf(y)).toBe("GENERATED")
  })

  it("leaves MANUAL consumers alone — the user wrote them", async () => {
    const { x, y } = graph({ status: "MANUAL" })
    await new PlanNodeService().patch(x, true, { content: "new" })
    expect(statusOf(y)).toBe("MANUAL")
  })

  it("demotes a consumer that is generating, so it does not keep a result built on the old input", async () => {
    const { x, y } = graph({ status: "GENERATING" })
    await new PlanNodeService().patch(x, true, { content: "new" })
    expect(statusOf(y)).toBe("OUTDATED")
  })
})
