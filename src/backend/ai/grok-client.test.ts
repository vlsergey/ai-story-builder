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

/** A stream as the API sends an answered call: the events, then the completion. */
function answered(events: Record<string, unknown>[]) {
  return makeStream([...events, { type: "response.completed", response: { usage: {} } }])
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
    mockCreate.mockResolvedValue(answered([event]))

    const onEvent = vi.fn()
    await grokGenerate(null, "fake-key", { model: "grok-3" }, onEvent)

    expect(onEvent).toHaveBeenCalledWith(event)
  })

  it("calls onEvent with response.output_item.done event when web_search_call completes without query", async () => {
    const event = {
      type: "response.output_item.done",
      item: { type: "web_search_call", status: "completed", action: { type: "search", sources: [] } },
    } as const
    mockCreate.mockResolvedValue(answered([event]))

    const onEvent = vi.fn()
    await grokGenerate(null, "fake-key", { model: "grok-3" }, onEvent)

    expect(onEvent).toHaveBeenCalledWith(event)
  })

  it("calls onEvent with response.output_item.done event for non-web_search_call items", async () => {
    const event = {
      type: "response.output_item.done",
      item: { type: "message", content: [] },
    } as const
    mockCreate.mockResolvedValue(answered([event]))

    const onEvent = vi.fn()
    await grokGenerate(null, "fake-key", { model: "grok-3" }, onEvent)

    expect(onEvent).toHaveBeenCalledWith(event)
  })
})

describe("grokGenerate — which output item the answer comes from", () => {
  beforeEach(() => mockCreate.mockReset())

  const delta = (output_index: number, d: string) => ({ type: "response.output_text.delta", output_index, delta: d })

  it("joins deltas of a single output item", async () => {
    mockCreate.mockResolvedValue(answered([delta(0, '{"a":'), delta(0, "1}")]))
    expect(await grokGenerate(null, "k", { model: "grok-3" })).toBe('{"a":1}')
  })

  it("returns the last item, not every item glued together", async () => {
    // Observed on grok-4.7 under a json_schema: an empty object in the first
    // output item, the real findings in the second. Concatenating them produced
    // `{"foundProblems": []}{"foundProblems":[…]}` — valid JSON followed by
    // junk, which JSON.parse rejects at the position where the second begins.
    mockCreate.mockResolvedValue(
      answered([delta(0, '{"foundProblems": []}'), delta(1, '{"foundProblems":['), delta(1, "{}]}")]),
    )
    expect(await grokGenerate(null, "k", { model: "grok-3" })).toBe('{"foundProblems":[{}]}')
  })

  it("ignores a trailing empty item", async () => {
    mockCreate.mockResolvedValue(answered([delta(0, '{"real":1}'), delta(1, "")]))
    expect(await grokGenerate(null, "k", { model: "grok-3" })).toBe('{"real":1}')
  })

  it("falls back to joining when the stream carries no output_index", async () => {
    mockCreate.mockResolvedValue(
      answered([
        { type: "response.output_text.delta", delta: "ab" },
        { type: "response.output_text.delta", delta: "cd" },
      ]),
    )
    expect(await grokGenerate(null, "k", { model: "grok-3" })).toBe("abcd")
  })

  it("answers empty when the response completed with nothing", async () => {
    mockCreate.mockResolvedValue(answered([{ type: "response.created" }]))
    expect(await grokGenerate(null, "k", { model: "grok-3" })).toBe("")
  })
})

// A call that yields no answer says why. Returning an empty string instead
// passed for success: the telemetry recorded it so, and the node then failed
// on "an empty answer" with the real reason lost.
describe("grokGenerate — a response that does not complete", () => {
  beforeEach(() => mockCreate.mockReset())

  const delta = (d: string) => ({ type: "response.output_text.delta", output_index: 0, delta: d })

  it("fails when the stream ends before the response completes", async () => {
    mockCreate.mockResolvedValue(makeStream([{ type: "response.created" }, delta('{"found')]))
    await expect(grokGenerate(null, "k", { model: "grok-3" })).rejects.toThrow(
      /ended before the response completed.*response\.output_text\.delta/,
    )
  })

  it("fails with what the stream's error event says", async () => {
    mockCreate.mockResolvedValue(
      makeStream([{ type: "response.created" }, { type: "error", code: "server_error", message: "Something broke" }]),
    )
    await expect(grokGenerate(null, "k", { model: "grok-3" })).rejects.toThrow(/server_error.*Something broke/)
  })

  it("fails with the model's refusal, not with an empty answer", async () => {
    mockCreate.mockResolvedValue(
      answered([
        { type: "response.refusal.delta", output_index: 0, delta: "I can't help " },
        { type: "response.refusal.delta", output_index: 0, delta: "with that." },
      ]),
    )
    await expect(grokGenerate(null, "k", { model: "grok-3" })).rejects.toThrow(/refused.*I can't help with that\./)
  })

  it("answers what it has when the caller stopped it: the caller sees its own signal", async () => {
    const stop = new AbortController()
    stop.abort()
    mockCreate.mockResolvedValue(makeStream([delta("half")]))
    expect(await grokGenerate(stop.signal, "k", { model: "grok-3" })).toBe("half")
  })
})
