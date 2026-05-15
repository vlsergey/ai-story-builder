import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { getCurrentDb } from "../../db/state.js"
import { setUpTestDb, tearDownTestDb } from "../../db/test-db-utils.js"
import { __resetForTests, finishRun, recordCall, startRun } from "./telemetry.js"

describe("telemetry", () => {
  beforeEach(() => {
    setUpTestDb()
    __resetForTests()
  })

  afterEach(() => {
    __resetForTests()
    tearDownTestDb()
  })

  it("records a call inside an active run and writes a run summary on finish", () => {
    const run_id = startRun()
    recordCall({
      engine_id: "grok",
      model: "grok-3",
      purpose: "generate-plan-node-text-content",
      prompt_cache_keys: ["generate-plan-node-text-content", "42"],
      node_title: "Профиль персонажа",
      node_type: "text",
      instructions_chars: 4000,
      input_chars: 18000,
      output_chars: 6200,
      input_tokens: 5000,
      output_tokens: 1600,
      cached_prompt_tokens: 4000,
      duration_ms: 24500,
      success: true,
      reported_cost_usd: 0.03,
    })
    finishRun()

    const db = getCurrentDb()
    const callRows = db.prepare("SELECT * FROM ai_call_stats").all() as any[]
    expect(callRows).toHaveLength(1)
    expect(callRows[0]).toMatchObject({
      run_id,
      engine_id: "grok",
      model: "grok-3",
      purpose: "generate-plan-node-text-content",
      node_title: "Профиль персонажа",
      node_type: "text",
      instructions_chars: 4000,
      input_chars: 18000,
      output_chars: 6200,
      input_tokens: 5000,
      output_tokens: 1600,
      cached_prompt_tokens: 4000,
      duration_ms: 24500,
      success: 1,
    })
    // cost_usd is whatever the provider reported via reported_cost_usd —
    // no local pricing-table calculation any more.
    expect(callRows[0].cost_usd).toBeCloseTo(0.03, 4)

    const runRows = db.prepare("SELECT * FROM ai_run_stats").all() as any[]
    expect(runRows).toHaveLength(1)
    expect(runRows[0]).toMatchObject({
      run_id,
      total_calls: 1,
      engine_id: "grok",
      model: "grok-3",
      sum_durations_ms: 24500,
      total_input_tokens: 5000,
      total_output_tokens: 1600,
      total_cached_prompt_tokens: 4000,
      success: 1,
    })
    expect(JSON.parse(runRows[0].calls_by_purpose)).toEqual({
      "generate-plan-node-text-content": 1,
    })
    expect(runRows[0].cost_usd).toBeCloseTo(0.03, 4)
  })

  it("persists cost_usd = null when the provider didn't report one (no local fallback)", () => {
    startRun()
    recordCall({
      engine_id: "grok",
      model: "grok-3",
      purpose: "generate-plan-node-text-content",
      instructions_chars: 100,
      input_chars: 100,
      output_chars: 100,
      input_tokens: 50,
      output_tokens: 30,
      cached_prompt_tokens: 0,
      duration_ms: 1000,
      success: true,
      // reported_cost_usd intentionally omitted
    })
    finishRun()

    const db = getCurrentDb()
    const row = db.prepare("SELECT cost_usd FROM ai_call_stats").get() as { cost_usd: number | null }
    expect(row.cost_usd).toBeNull()
    const runRow = db.prepare("SELECT cost_usd FROM ai_run_stats").get() as { cost_usd: number | null }
    expect(runRow.cost_usd).toBeNull()
  })

  it("marks the run as failed when at least one call fails", () => {
    startRun()
    recordCall({
      engine_id: "grok",
      model: "grok-3",
      purpose: "generate-plan-node-text-content",
      instructions_chars: 100,
      input_chars: 100,
      output_chars: 0,
      duration_ms: 12,
      success: false,
      error_message: "boom",
    })
    finishRun()

    const db = getCurrentDb()
    const run = db.prepare("SELECT success FROM ai_run_stats").get() as { success: number }
    expect(run.success).toBe(0)
  })

  it("records orphan calls (no active run) with a synthetic run_id and skips ai_run_stats", () => {
    recordCall({
      engine_id: "grok",
      model: "grok-3",
      purpose: "generate-summary",
      instructions_chars: 50,
      input_chars: 80,
      output_chars: 12,
      duration_ms: 250,
      success: true,
    })

    const db = getCurrentDb()
    const callRows = db.prepare("SELECT run_id FROM ai_call_stats").all() as { run_id: string }[]
    expect(callRows).toHaveLength(1)
    expect(callRows[0].run_id).toMatch(/^orphan-/)
    const runRows = db.prepare("SELECT * FROM ai_run_stats").all()
    expect(runRows).toHaveLength(0)
  })

  it("accumulates calls_by_purpose across multiple calls", () => {
    startRun()
    recordCall({
      engine_id: "grok",
      model: "grok-3",
      purpose: "generate-plan-node-text-content",
      instructions_chars: 0,
      input_chars: 0,
      output_chars: 0,
      duration_ms: 1,
      success: true,
    })
    recordCall({
      engine_id: "grok",
      model: "grok-3",
      purpose: "generate-plan-node-text-content",
      instructions_chars: 0,
      input_chars: 0,
      output_chars: 0,
      duration_ms: 1,
      success: true,
    })
    recordCall({
      engine_id: "grok",
      model: "grok-3",
      purpose: "generate-summary",
      instructions_chars: 0,
      input_chars: 0,
      output_chars: 0,
      duration_ms: 1,
      success: true,
    })
    finishRun()

    const db = getCurrentDb()
    const run = db.prepare("SELECT calls_by_purpose, total_calls FROM ai_run_stats").get() as {
      calls_by_purpose: string
      total_calls: number
    }
    expect(run.total_calls).toBe(3)
    expect(JSON.parse(run.calls_by_purpose)).toEqual({
      "generate-plan-node-text-content": 2,
      "generate-summary": 1,
    })
  })
})
