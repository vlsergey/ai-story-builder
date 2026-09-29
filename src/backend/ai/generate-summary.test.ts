import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SettingsMap } from "../../shared/settings.js"
import { setUpTestDb, tearDownTestDb } from "../db/test-db-utils.js"
import { SettingsRepository } from "../settings/settings-repository.js"

const seen: Array<{ aiGenerationSettings?: Record<string, unknown> }> = []
vi.mock("./ai-engine-adapter.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ai-engine-adapter.js")>()),
  getEngineAdapter: () => ({
    generateResponse: async (req: { aiGenerationSettings?: Record<string, unknown> }) => {
      seen.push(req)
      return "a summary"
    },
  }),
}))

import { generateSummary } from "./generate-summary.js"

function configure(grok: Record<string, unknown>) {
  SettingsRepository.set(SettingsMap.currentBackend, "grok")
  SettingsRepository.set(SettingsMap.allAiEnginesConfig, {
    grok: { generateSummaryInstructions: "Summarise.", ...grok },
  })
}

describe("generateSummary — the summary settings the editor offers are the ones used", () => {
  beforeEach(() => {
    setUpTestDb()
    seen.length = 0
  })
  afterEach(() => tearDownTestDb())

  it("applies the summary settings on top of the defaults", async () => {
    // Every real Grok project configured summaries to be cheap — a smaller
    // model, no web search, no reasoning — and every summary ran on the full
    // defaults anyway: 15–23% of all spend.
    configure({
      defaultAiGenerationSettings: { model: "grok-4.7", web_search: true, reasoning_effort: "medium" },
      summaryAiGenerationSettings: { model: "grok-4.3", web_search: false, reasoning_effort: "none" },
    })
    await generateSummary(new AbortController().signal, ["k"], "some text")
    expect(seen[0].aiGenerationSettings).toMatchObject({
      model: "grok-4.3",
      web_search: false,
      reasoning_effort: "none",
    })
  })

  it("inherits from the defaults whatever the summary settings leave out", async () => {
    configure({
      defaultAiGenerationSettings: { model: "grok-4.7", x_search: false, reasoning_effort: "medium" },
      summaryAiGenerationSettings: { model: "grok-4.3" },
    })
    await generateSummary(new AbortController().signal, ["k"], "some text")
    expect(seen[0].aiGenerationSettings).toMatchObject({
      model: "grok-4.3",
      x_search: false,
      reasoning_effort: "medium",
    })
  })

  it("uses the defaults when no summary settings exist", async () => {
    configure({ defaultAiGenerationSettings: { model: "grok-4.7" } })
    await generateSummary(new AbortController().signal, ["k"], "some text")
    expect(seen[0].aiGenerationSettings).toMatchObject({ model: "grok-4.7" })
  })
})
