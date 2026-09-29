import { beforeEach, describe, expect, it, vi } from "vitest"

const create = vi.fn(async (_params: unknown, _opts?: unknown) => (async function* () {})())
vi.mock("./yandex-client.js", () => ({
  createYandexClient: () => ({
    responses: { create: (params: unknown, opts?: unknown) => create(params, opts) },
  }),
}))

import { YandexAdapter } from "./yandex-adapter.js"

function request(settings: Record<string, unknown>, engineConfig: Record<string, unknown> = {}) {
  return {
    abortSignal: new AbortController().signal,
    systemPrompt: "",
    userPrompt: "u",
    includeExistingLore: false,
    aiGenerationSettings: settings,
    promptCacheKeys: ["test"],
    engineFileIds: [],
    engineConfig: { api_key: "k", folder_id: "f", ...engineConfig },
  } as never
}

/** Request body handed to the Yandex Responses API. */
function sent(): Record<string, unknown> {
  return create.mock.calls[0][0] as Record<string, unknown>
}

describe("YandexAdapter — the settings the form writes reach the request", () => {
  beforeEach(() => create.mockClear())

  it("sends the token limit under the key the settings form stores", async () => {
    // The field is `max_completion_tokens`; the adapter read `maxCompletionTokens`,
    // a key neither the form nor the type declares, so the limit never left.
    await new YandexAdapter().generateResponse(request({ max_completion_tokens: 1500 }))
    expect(sent().max_output_tokens).toBe(1500)
  })

  it("leaves an unset token limit to the provider", async () => {
    await new YandexAdapter().generateResponse(request({}))
    expect(sent()).not.toHaveProperty("max_output_tokens")
  })

  it("takes engine defaults from defaultAiGenerationSettings, where the editor writes them", async () => {
    await new YandexAdapter().generateResponse(
      request({}, { defaultAiGenerationSettings: { webSearch: "low", max_completion_tokens: 900 } }),
    )
    expect(sent().max_output_tokens).toBe(900)
    expect(sent().tools).toEqual([expect.objectContaining({ type: "web_search", search_context_size: "low" })])
  })

  it("lets a request setting override the engine default", async () => {
    await new YandexAdapter().generateResponse(
      request({ max_completion_tokens: 300 }, { defaultAiGenerationSettings: { max_completion_tokens: 900 } }),
    )
    expect(sent().max_output_tokens).toBe(300)
  })
})
