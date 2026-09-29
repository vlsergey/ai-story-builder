import { beforeEach, describe, expect, it, vi } from "vitest"

// Must mock before importing grok-client
const mockCreate = vi.fn()
vi.mock("openai", () => ({
  // biome-ignore lint/complexity/useArrowFunction: Use a regular function (not arrow) so it can be used as a constructor with `new`
  default: vi.fn().mockImplementation(function () {
    return { responses: { create: mockCreate } }
  }),
}))
vi.mock("./ai-logging.js", () => ({
  makeLoggingFetch: () => undefined,
  isVerboseLogging: () => false,
}))

import { grokGenerate } from "./grok-client.js"

function makeStream(events: Record<string, unknown>[]) {
  return (async function* () {
    for (const ev of events) yield ev
  })()
}

describe("grokGenerate — onEvent callbacks", () => {
  beforeEach(() => mockCreate.mockReset())

  it("calls onEvent with response.output_item.done event when web_search_call completes", async () => {
    const event = {
      type: "response.output_item.done",
      item: {
        type: "web_search_call",
        status: "completed",
        action: { type: "search", query: "some search query", sources: [] },
      },
    } as const
    mockCreate.mockResolvedValue(makeStream([event]))

    const onEvent = vi.fn()
    await grokGenerate(null, "fake-key", { model: "grok-3" }, onEvent)

    expect(onEvent).toHaveBeenCalledWith(event)
  })

  it("calls onEvent with response.output_item.done event when web_search_call completes without query", async () => {
    const event = {
      type: "response.output_item.done",
      item: { type: "web_search_call", status: "completed", action: { type: "search", sources: [] } },
    } as const
    mockCreate.mockResolvedValue(makeStream([event]))

    const onEvent = vi.fn()
    await grokGenerate(null, "fake-key", { model: "grok-3" }, onEvent)

    expect(onEvent).toHaveBeenCalledWith(event)
  })

  it("calls onEvent with response.output_item.done event for non-web_search_call items", async () => {
    const event = {
      type: "response.output_item.done",
      item: { type: "message", content: [] },
    } as const
    mockCreate.mockResolvedValue(makeStream([event]))

    const onEvent = vi.fn()
    await grokGenerate(null, "fake-key", { model: "grok-3" }, onEvent)

    expect(onEvent).toHaveBeenCalledWith(event)
  })
})

describe("grokGenerate — which output item the answer comes from", () => {
  beforeEach(() => mockCreate.mockReset())

  const delta = (output_index: number, d: string) => ({ type: "response.output_text.delta", output_index, delta: d })

  it("joins deltas of a single output item", async () => {
    mockCreate.mockResolvedValue(makeStream([delta(0, '{"a":'), delta(0, "1}")]))
    expect(await grokGenerate(null, "k", { model: "grok-3" })).toBe('{"a":1}')
  })

  it("returns the last item, not every item glued together", async () => {
    // Observed on grok-4.7 under a json_schema: an empty object in the first
    // output item, the real findings in the second. Concatenating them produced
    // `{"foundProblems": []}{"foundProblems":[…]}` — valid JSON followed by
    // junk, which JSON.parse rejects at the position where the second begins.
    mockCreate.mockResolvedValue(
      makeStream([delta(0, '{"foundProblems": []}'), delta(1, '{"foundProblems":['), delta(1, "{}]}")]),
    )
    expect(await grokGenerate(null, "k", { model: "grok-3" })).toBe('{"foundProblems":[{}]}')
  })

  it("ignores a trailing empty item", async () => {
    mockCreate.mockResolvedValue(makeStream([delta(0, '{"real":1}'), delta(1, "")]))
    expect(await grokGenerate(null, "k", { model: "grok-3" })).toBe('{"real":1}')
  })

  it("falls back to joining when the stream carries no output_index", async () => {
    mockCreate.mockResolvedValue(
      makeStream([
        { type: "response.output_text.delta", delta: "ab" },
        { type: "response.output_text.delta", delta: "cd" },
      ]),
    )
    expect(await grokGenerate(null, "k", { model: "grok-3" })).toBe("abcd")
  })

  it("returns an empty string when nothing was emitted", async () => {
    mockCreate.mockResolvedValue(makeStream([{ type: "response.created" }]))
    expect(await grokGenerate(null, "k", { model: "grok-3" })).toBe("")
  })
})
