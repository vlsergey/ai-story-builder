import { beforeEach, describe, expect, it, vi } from "vitest"

const grokGenerate = vi.fn(async () => "ok")
vi.mock("./grok-client.js", () => ({
  grokGenerate: (...args: unknown[]) => grokGenerate(...(args as [])),
}))

import { GrokAdapter } from "./grok-adapter.js"

function request(settings: Record<string, unknown>) {
  return {
    abortSignal: new AbortController().signal,
    systemPrompt: "",
    userPrompt: "u",
    includeExistingLore: false,
    aiGenerationSettings: settings,
    promptCacheKeys: ["test"],
    engineFileIds: [],
    engineConfig: { api_key: "k" },
  } as never
}

/** The request body handed to the client — third argument of grokGenerate. */
function sent(): Record<string, unknown> {
  const call = grokGenerate.mock.calls[0] as unknown as [unknown, unknown, Record<string, unknown>]
  return call[2]
}

describe("GrokAdapter — a zero is sent, an absence is not", () => {
  beforeEach(() => grokGenerate.mockClear())

  it("sends temperature 0 as 0 rather than dropping it", async () => {
    await new GrokAdapter().generateResponse(request({ model: "m", temperature: 0 }))
    expect(sent().temperature).toBe(0)
  })

  it("sends top_p 0 as 0 rather than dropping it", async () => {
    await new GrokAdapter().generateResponse(request({ model: "m", top_p: 0 }))
    expect(sent().top_p).toBe(0)
  })

  it("leaves unset values to the provider", async () => {
    await new GrokAdapter().generateResponse(request({ model: "m" }))
    expect(sent().temperature).toBeUndefined()
    expect(sent().top_p).toBeUndefined()
    expect(sent().max_output_tokens).toBeUndefined()
  })

  it("passes ordinary values through", async () => {
    await new GrokAdapter().generateResponse(request({ model: "m", temperature: 0.8, max_output_tokens: 4000 }))
    expect(sent()).toMatchObject({ temperature: 0.8, max_output_tokens: 4000 })
  })

  it("does not send what is not a number", async () => {
    await new GrokAdapter().generateResponse(request({ model: "m", temperature: "0.7", top_p: Number.NaN }))
    expect(sent().temperature).toBeUndefined()
    expect(sent().top_p).toBeUndefined()
  })
})
