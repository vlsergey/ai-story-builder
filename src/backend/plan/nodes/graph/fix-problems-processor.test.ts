import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { setUpTestDb, tearDownTestDb } from "../../../db/test-db-utils.js"
import { PlanEdgeRepository } from "../../edges/plan-edge-repository.js"
import { PlanNodeService } from "../plan-node-service.js"
import { FixProblemsProcessor } from "./fix-problems-processor.js"

// findProblems is the LLM call inside the fix-problems loop. We stub it to
// return zero problems above the severity threshold so the loop exits after
// the first iteration without ever calling fixProblems — the summary
// short-circuit doesn't depend on what happens during the loop.
vi.mock("../../../ai/generate-fix-problems.js", () => ({
  findProblems: vi.fn(async () => ({ foundProblems: [] })),
  fixProblems: vi.fn(async () => "should-not-be-called"),
}))

describe("FixProblemsProcessor", () => {
  beforeEach(() => setUpTestDb())
  afterEach(() => {
    tearDownTestDb()
    vi.clearAllMocks()
  })

  it("inherits the source node's summary so PlanNodeService.regenerate skips LLM auto-summary", async () => {
    const service = new PlanNodeService()
    const source = service.create({
      type: "text",
      title: "Source",
      content: "source content",
      summary: "source-summary-text",
    })
    service.repo.patch(source.id, { status: "GENERATED" })

    const fp = service.create({
      type: "fix-problems",
      title: "Reviewer",
      node_type_settings: JSON.stringify({
        maxIterations: 1,
        minSeverityToFix: 50,
        foundProblemsTemplate: "found-problems",
        sourceNodeIdToFix: source.id,
      }),
    })
    new PlanEdgeRepository().insert({ from_node_id: source.id, to_node_id: fp.id, type: "text" })

    const proc = new FixProblemsProcessor()
    const fakeContext = {
      abortSignal: new AbortController().signal,
      nodeId: fp.id,
      asCycle: async (_n: unknown, block: (ctx: any) => Promise<unknown>) => {
        await block({
          asNode: async (_i: number, b: (nc: any) => Promise<unknown>) => {
            await b({ onResponseStreamEvent: () => {} })
          },
        })
      },
    } as any

    const patch = await proc.regenerate(service, fakeContext, service.getById(fp.id), proc.defaultSettings as any)

    expect(patch, "regenerate should return a patch").toBeTruthy()
    expect(patch!.summary, "summary must be inherited from source").toBe("source-summary-text")
    expect(patch!.status).toBe("GENERATED")
  })

  it("copies null summary cleanly when source has no summary yet", async () => {
    const service = new PlanNodeService()
    const source = service.create({ type: "text", title: "Source", content: "x" })
    service.repo.patch(source.id, { status: "GENERATED" })

    const fp = service.create({
      type: "fix-problems",
      title: "Reviewer",
      node_type_settings: JSON.stringify({
        maxIterations: 1,
        minSeverityToFix: 50,
        foundProblemsTemplate: "fp",
        sourceNodeIdToFix: source.id,
      }),
    })
    new PlanEdgeRepository().insert({ from_node_id: source.id, to_node_id: fp.id, type: "text" })

    const proc = new FixProblemsProcessor()
    const fakeContext = {
      abortSignal: new AbortController().signal,
      nodeId: fp.id,
      asCycle: async (_n: unknown, block: (ctx: any) => Promise<unknown>) => {
        await block({
          asNode: async (_i: number, b: (nc: any) => Promise<unknown>) => {
            await b({ onResponseStreamEvent: () => {} })
          },
        })
      },
    } as any

    const patch = await proc.regenerate(service, fakeContext, service.getById(fp.id), proc.defaultSettings as any)

    expect(patch!.summary).toBeNull()
  })
})
