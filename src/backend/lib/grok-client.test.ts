import { describe, it, expect, vi, beforeEach } from "vitest"

// Must mock before importing grok-client
const mockCreate = vi.fn()
vi.mock("openai", () => ({
  // Use a regular function (not arrow) so it can be used as a constructor with `new`
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
    await grokGenerate("fake-key", { model: "grok-3" }, onEvent)

    expect(onEvent).toHaveBeenCalledWith(event)
  })

  it("calls onEvent with response.output_item.done event when web_search_call completes without query", async () => {
    const event = {
      type: "response.output_item.done",
      item: { type: "web_search_call", status: "completed", action: { type: "search", sources: [] } },
    } as const
    mockCreate.mockResolvedValue(makeStream([event]))

    const onEvent = vi.fn()
    await grokGenerate("fake-key", { model: "grok-3" }, onEvent)

    expect(onEvent).toHaveBeenCalledWith(event)
  })

  it("calls onEvent with response.output_item.done event for non-web_search_call items", async () => {
    const event = {
      type: "response.output_item.done",
      item: { type: "message", content: [] },
    } as const
    mockCreate.mockResolvedValue(makeStream([event]))

    const onEvent = vi.fn()
    await grokGenerate("fake-key", { model: "grok-3" }, onEvent)

    expect(onEvent).toHaveBeenCalledWith(event)
  })
})
