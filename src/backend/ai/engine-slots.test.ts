import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { setUpTestDb, tearDownTestDb } from "../db/test-db-utils.js"
import { SettingsRepository } from "../settings/settings-repository.js"
import { maxConcurrentCalls, withEngineSlot } from "./engine-slots.js"

/** Runs `count` calls at once through the engine's slots and reports the most that ran together. */
async function peakConcurrency(engine: "grok" | "ollama", count: number): Promise<number> {
  let running = 0
  let peak = 0
  await Promise.all(
    Array.from({ length: count }, () =>
      withEngineSlot(engine, undefined, async () => {
        running++
        peak = Math.max(peak, running)
        await new Promise((resolve) => setTimeout(resolve, 5))
        running--
      }),
    ),
  )
  return peak
}

describe("engine slots", () => {
  beforeEach(() => setUpTestDb())
  afterEach(() => tearDownTestDb())

  it("lets a local model take one call at a time and a cloud engine ten, unless set otherwise", async () => {
    expect(maxConcurrentCalls("ollama")).toBe(1)
    expect(maxConcurrentCalls("yandex")).toBe(10)
    expect(maxConcurrentCalls("grok")).toBe(10)

    expect(await peakConcurrency("ollama", 4)).toBe(1)
    expect(await peakConcurrency("grok", 14)).toBe(10)
  })

  it("follows the engine's setting", async () => {
    SettingsRepository.setAllAiEnginesConfig({ grok: { max_concurrent_calls: 3 }, ollama: { max_concurrent_calls: 2 } })

    expect(await peakConcurrency("grok", 8)).toBe(3)
    expect(await peakConcurrency("ollama", 8)).toBe(2)
  })

  it("starts the calls already waiting when the limit is raised", async () => {
    SettingsRepository.setAllAiEnginesConfig({ grok: { max_concurrent_calls: 1 } })
    let release: () => void = () => {}
    let running = 0
    let peak = 0
    const call = () =>
      withEngineSlot("grok", undefined, async () => {
        running++
        peak = Math.max(peak, running)
        await new Promise((resolve) => setTimeout(resolve, 5))
        running--
      })
    const busy = withEngineSlot("grok", undefined, () => new Promise<void>((resolve) => (release = resolve)))
    const waiting = [call(), call(), call()]

    SettingsRepository.setAllAiEnginesConfig({ grok: { max_concurrent_calls: 5 } })
    release()
    await Promise.all([busy, ...waiting])

    expect(peak).toBe(3)
  })

  it("gives up waiting for a slot when the call is aborted", async () => {
    SettingsRepository.setAllAiEnginesConfig({ grok: { max_concurrent_calls: 1 } })
    let release: () => void = () => {}
    const busy = withEngineSlot("grok", undefined, () => new Promise<void>((resolve) => (release = resolve)))
    const controller = new AbortController()
    let ran = false
    const waiting = withEngineSlot("grok", controller.signal, async () => {
      ran = true
    })

    controller.abort()

    await expect(waiting).rejects.toThrow(/abort/i)
    release()
    await busy
    expect(ran).toBe(false)
    // The slot the aborted call waited for went to nobody: the next call gets it.
    expect(await peakConcurrency("grok", 2)).toBe(1)
  })
})
