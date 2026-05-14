import { randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { getCurrentDb, getDataDir, isOpen } from "../../db/state.js"
import { SettingsRepository } from "../../settings/settings-repository.js"
import { estimateCostUsd } from "./pricing.js"

/**
 * Local-only telemetry for LLM calls and regenerate-tree runs.
 *
 * Two streams, dual-written:
 *   - per-call: project DB `ai_call_stats` + global `<userData>/telemetry/ai-calls.jsonl`
 *   - per-run:  project DB `ai_run_stats`  + global `<userData>/telemetry/ai-runs.jsonl`
 *
 * Nothing ever leaves the user's machine. The global JSONL exists so the
 * template-duration estimator can aggregate across projects (per-(engine,
 * model, node_type, purpose) curves don't generalise from one project alone).
 */

export interface RecordCallArgs {
  engine_id: string
  model: string
  /** First element of promptCacheKeys — what kind of call this is within the node. */
  purpose: string
  prompt_cache_keys?: string[] | null
  node_title?: string | null
  node_type?: string | null
  /** Static system+user prompt template length before any placeholder substitution. */
  instructions_chars: number
  /** Full input the model saw (substituted prompt + content). */
  input_chars: number
  output_chars: number
  input_tokens?: number | null
  output_tokens?: number | null
  cached_prompt_tokens?: number | null
  duration_ms: number
  success: boolean
  error_message?: string | null
}

interface PerRunAccumulator {
  run_id: string
  started_at: Date
  template_file: string | null
  engines: Set<string>
  models: Set<string>
  total_calls: number
  calls_by_purpose: Map<string, number>
  sum_durations_ms: number
  total_input_tokens: number
  total_output_tokens: number
  total_cached_prompt_tokens: number
  cost_usd: number | null
  any_failure: boolean
}

let activeRun: PerRunAccumulator | null = null

function telemetryDir(): string {
  return path.join(getDataDir(), "telemetry")
}

function isUnderTest(): boolean {
  // Vitest sets process.env.VITEST = "true" inside the test runtime. We refuse
  // to touch the global JSONL telemetry log while running tests so test runs
  // don't pollute the user's actual on-disk telemetry.
  return process.env.VITEST === "true" || process.env.NODE_ENV === "test"
}

function appendJsonlSafe(file: string, record: unknown): void {
  if (isUnderTest()) return
  try {
    const dir = path.dirname(file)
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8")
  } catch (err) {
    // Telemetry must never block AI work. Log and continue.
    console.warn(`[telemetry] failed to append to ${file}:`, err)
  }
}

function safeReadAppliedTemplateFile(): string | null {
  if (!isOpen()) return null
  try {
    return SettingsRepository.getAppliedTemplateFile()
  } catch {
    return null
  }
}

export function startRun(): string {
  if (activeRun) {
    console.warn(`[telemetry] startRun called while run ${activeRun.run_id} is active; overwriting`)
  }
  const run_id = randomUUID()
  activeRun = {
    run_id,
    started_at: new Date(),
    template_file: safeReadAppliedTemplateFile(),
    engines: new Set(),
    models: new Set(),
    total_calls: 0,
    calls_by_purpose: new Map(),
    sum_durations_ms: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_cached_prompt_tokens: 0,
    cost_usd: null,
    any_failure: false,
  }
  return run_id
}

export function getActiveRunId(): string | null {
  return activeRun?.run_id ?? null
}

export function recordCall(args: RecordCallArgs): void {
  if (!activeRun) {
    // Calls that fire outside an explicit regen-tree run (e.g. a one-off
    // "improve this node" mutation) are not part of an estimator-friendly run.
    // We still want to record the call itself for per-node statistics.
    recordOrphanCall(args)
    return
  }

  const ts = new Date()
  const cost = estimateCostUsd(args.engine_id, args.model, {
    input_tokens: args.input_tokens,
    output_tokens: args.output_tokens,
    cached_prompt_tokens: args.cached_prompt_tokens,
  })

  activeRun.engines.add(args.engine_id)
  activeRun.models.add(args.model)
  activeRun.total_calls += 1
  activeRun.calls_by_purpose.set(args.purpose, (activeRun.calls_by_purpose.get(args.purpose) ?? 0) + 1)
  activeRun.sum_durations_ms += args.duration_ms
  activeRun.total_input_tokens += args.input_tokens ?? 0
  activeRun.total_output_tokens += args.output_tokens ?? 0
  activeRun.total_cached_prompt_tokens += args.cached_prompt_tokens ?? 0
  if (cost != null) activeRun.cost_usd = (activeRun.cost_usd ?? 0) + cost
  if (!args.success) activeRun.any_failure = true

  writeCallRecord(activeRun.run_id, ts, cost, args)
}

function recordOrphanCall(args: RecordCallArgs): void {
  const cost = estimateCostUsd(args.engine_id, args.model, {
    input_tokens: args.input_tokens,
    output_tokens: args.output_tokens,
    cached_prompt_tokens: args.cached_prompt_tokens,
  })
  // Synthetic run_id so the row is still queryable, but it doesn't get an
  // ai_run_stats counterpart. "orphan-<uuid>" is the convention.
  writeCallRecord(`orphan-${randomUUID()}`, new Date(), cost, args)
}

function writeCallRecord(run_id: string, ts: Date, cost: number | null, args: RecordCallArgs): void {
  const tsIso = ts.toISOString()
  const cacheKeysJson = args.prompt_cache_keys ? JSON.stringify(args.prompt_cache_keys) : null

  if (isOpen()) {
    try {
      const db = getCurrentDb()
      db.prepare(`INSERT INTO ai_call_stats (
        ts, run_id, engine_id, model, purpose, prompt_cache_keys,
        node_title, node_type,
        instructions_chars, input_chars, output_chars,
        input_tokens, output_tokens, cached_prompt_tokens,
        duration_ms, cost_usd, success, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        tsIso,
        run_id,
        args.engine_id,
        args.model,
        args.purpose,
        cacheKeysJson,
        args.node_title ?? null,
        args.node_type ?? null,
        args.instructions_chars,
        args.input_chars,
        args.output_chars,
        args.input_tokens ?? null,
        args.output_tokens ?? null,
        args.cached_prompt_tokens ?? null,
        args.duration_ms,
        cost,
        args.success ? 1 : 0,
        args.error_message ?? null,
      )
    } catch (err) {
      console.warn("[telemetry] failed to write ai_call_stats:", err)
    }
  }

  appendJsonlSafe(path.join(telemetryDir(), "ai-calls.jsonl"), {
    ts: tsIso,
    run_id,
    engine_id: args.engine_id,
    model: args.model,
    purpose: args.purpose,
    prompt_cache_keys: args.prompt_cache_keys ?? null,
    node_title: args.node_title ?? null,
    node_type: args.node_type ?? null,
    instructions_chars: args.instructions_chars,
    input_chars: args.input_chars,
    output_chars: args.output_chars,
    input_tokens: args.input_tokens ?? null,
    output_tokens: args.output_tokens ?? null,
    cached_prompt_tokens: args.cached_prompt_tokens ?? null,
    duration_ms: args.duration_ms,
    cost_usd: cost,
    success: args.success,
    error_message: args.error_message ?? null,
  })
}

export function finishRun(opts?: { success?: boolean }): void {
  if (!activeRun) {
    console.warn("[telemetry] finishRun called with no active run")
    return
  }
  const run = activeRun
  activeRun = null

  const finished_at = new Date()
  const wall_time_ms = finished_at.getTime() - run.started_at.getTime()
  const overall_success = opts?.success ?? !run.any_failure
  const callsByPurposeObj = Object.fromEntries(run.calls_by_purpose)

  // If exactly one engine/model was used, store it scalarly; if mixed, store
  // the comma-joined list as a quick debug aid.
  const engineId =
    run.engines.size === 1 ? [...run.engines][0] : run.engines.size > 1 ? [...run.engines].join(",") : null
  const model = run.models.size === 1 ? [...run.models][0] : run.models.size > 1 ? [...run.models].join(",") : null

  const summary = {
    run_id: run.run_id,
    started_at: run.started_at.toISOString(),
    finished_at: finished_at.toISOString(),
    wall_time_ms,
    template_file: run.template_file,
    engine_id: engineId,
    model,
    total_calls: run.total_calls,
    calls_by_purpose: callsByPurposeObj,
    sum_durations_ms: run.sum_durations_ms,
    total_input_tokens: run.total_input_tokens || null,
    total_output_tokens: run.total_output_tokens || null,
    total_cached_prompt_tokens: run.total_cached_prompt_tokens || null,
    cost_usd: run.cost_usd,
    success: overall_success,
  }

  if (isOpen()) {
    try {
      const db = getCurrentDb()
      db.prepare(`INSERT INTO ai_run_stats (
        run_id, started_at, finished_at, wall_time_ms, template_file,
        engine_id, model, total_calls, calls_by_purpose, sum_durations_ms,
        total_input_tokens, total_output_tokens, total_cached_prompt_tokens,
        cost_usd, success
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        summary.run_id,
        summary.started_at,
        summary.finished_at,
        summary.wall_time_ms,
        summary.template_file,
        summary.engine_id,
        summary.model,
        summary.total_calls,
        JSON.stringify(summary.calls_by_purpose),
        summary.sum_durations_ms,
        summary.total_input_tokens,
        summary.total_output_tokens,
        summary.total_cached_prompt_tokens,
        summary.cost_usd,
        summary.success ? 1 : 0,
      )
    } catch (err) {
      console.warn("[telemetry] failed to write ai_run_stats:", err)
    }
  }

  appendJsonlSafe(path.join(telemetryDir(), "ai-runs.jsonl"), summary)
}

/** Test-only: drop any active run state without writing a summary. */
export function __resetForTests(): void {
  activeRun = null
}
