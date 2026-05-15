#!/usr/bin/env tsx
/**
 * Aggregate local LLM-call telemetry into per-bucket medians.
 *
 * The script does NOT walk any template and does NOT estimate cost for a
 * specific template. It just crunches `<userData>/telemetry/ai-calls.jsonl`
 * into compact numerical statistics that a human (or LLM) can then combine
 * with their knowledge of a template's structure and expected iteration
 * counts.
 *
 * Usage:
 *   npx tsx scripts/aggregate-telemetry.ts [options]
 *
 * Options:
 *   --engine <id>       Filter to this engine (default: include all).
 *   --model <name>      Filter to this model (default: include all).
 *   --since <iso>       Only include records with ts >= this ISO date.
 *   --by <keys>         Aggregation keys, comma-separated. Allowed: engine,
 *                       model, purpose, node_type, node_title,
 *                       input_tokens_bucket (<2k / 2k–8k / 8k–32k / >32k;
 *                       records with no input_tokens land in '?').
 *                       Default: engine,model,purpose.
 *   --json              Emit the aggregated buckets as JSON instead of a table.
 *   --telemetry <path>  Override telemetry JSONL path.
 */
import { readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"

interface CallRecord {
  ts: string
  run_id: string
  engine_id: string
  model: string
  purpose: string
  node_title: string | null
  node_type: string | null
  instructions_chars: number
  input_chars: number
  output_chars: number
  input_tokens: number | null
  output_tokens: number | null
  cached_prompt_tokens: number | null
  duration_ms: number
  cost_usd: number | null
  success: boolean
  iteration_index?: number | null
}

type BucketKey = "engine" | "model" | "purpose" | "node_type" | "node_title" | "input_tokens_bucket"

const ALLOWED_KEYS: BucketKey[] = ["engine", "model", "purpose", "node_type", "node_title", "input_tokens_bucket"]

/**
 * Coarse buckets over `input_tokens` so the aggregator can split a
 * heterogeneous (engine, model, purpose) cluster into size-tiers — short
 * profile reviews vs whole-scene polish reviews land in different buckets
 * and get accurate p50–p90 each. Boundaries chosen by inspection of fiction-
 * arc data; can be made configurable later if more granularity is needed.
 */
function inputTokensBucket(tokens: number | null | undefined): string {
  if (typeof tokens !== "number" || !Number.isFinite(tokens)) return "?"
  if (tokens < 2000) return "<2k"
  if (tokens < 8000) return "2k–8k"
  if (tokens < 32000) return "8k–32k"
  return ">32k"
}

/**
 * For each numeric metric we report two percentiles: p50 (median) and p90
 * (90th percentile). The pair shows both "typical cost/duration" and the
 * tail — useful when the tail is what determines whether a template run
 * will or won't fit in the user's budget.
 */
interface PercentilePair {
  p50: number
  p90: number
}
interface BucketStats {
  key: Partial<Record<BucketKey, string | null>>
  count: number
  failed: number
  duration_ms: PercentilePair
  input_tokens: PercentilePair | null
  output_tokens: PercentilePair | null
  cached_prompt_tokens: PercentilePair | null
  median_cached_fraction: number | null
  instructions_chars: PercentilePair
  input_chars: PercentilePair
  output_chars: PercentilePair
  cost_usd: PercentilePair | null
  total_cost_usd: number | null
  /**
   * Iterations per visit, for buckets that include records with
   * `iteration_index`. A "visit" is a contiguous run of records sharing
   * (run_id, node_title) within this bucket whose iteration_index starts at
   * 0; max(iteration_index)+1 within the visit = iterations to converge.
   * `null` when the bucket has no records carrying iteration_index.
   */
  iterations_per_visit: PercentilePair | null
  visits_count: number | null
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  engine?: string
  model?: string
  since?: Date
  by: BucketKey[]
  asJson: boolean
  telemetry?: string
} {
  let engine: string | undefined
  let model: string | undefined
  let since: Date | undefined
  let by: BucketKey[] = ["engine", "model", "purpose"]
  let asJson = false
  let telemetry: string | undefined

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--engine") engine = argv[++i]
    else if (a === "--model") model = argv[++i]
    else if (a === "--since") {
      const d = new Date(argv[++i])
      if (Number.isNaN(d.getTime())) throw new Error(`bad --since date`)
      since = d
    } else if (a === "--by") {
      const parts = argv[++i].split(",").map((s) => s.trim()) as BucketKey[]
      for (const p of parts) {
        if (!ALLOWED_KEYS.includes(p)) throw new Error(`unknown --by key: ${p} (allowed: ${ALLOWED_KEYS.join(",")})`)
      }
      by = parts
    } else if (a === "--json") asJson = true
    else if (a === "--telemetry") telemetry = argv[++i]
    else throw new Error(`unknown option: ${a}`)
  }
  return { engine, model, since, by, asJson, telemetry }
}

function defaultTelemetryPath(): string {
  const home = os.homedir()
  let appData: string
  switch (process.platform) {
    case "win32":
      appData = process.env.APPDATA || path.join(home, "AppData", "Roaming")
      break
    case "darwin":
      appData = path.join(home, "Library", "Application Support")
      break
    default:
      appData = process.env.XDG_CONFIG_HOME || path.join(home, ".config")
  }
  return path.join(appData, "ai-story-builder", "telemetry", "ai-calls.jsonl")
}

function loadTelemetry(jsonlPath: string): CallRecord[] {
  const raw = readFileSync(jsonlPath, "utf8")
  const records: CallRecord[] = []
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line)
      if (r && typeof r === "object" && typeof r.purpose === "string") records.push(r as CallRecord)
    } catch (e) {
      console.warn(`[aggregate] skipping malformed line: ${(e as Error).message}`)
    }
  }
  return records
}

// ── Stats ────────────────────────────────────────────────────────────────────

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0
  if (sortedValues.length === 1) return sortedValues[0]
  // Linear interpolation between closest ranks (R-7 / Excel / numpy default).
  const rank = (sortedValues.length - 1) * p
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  if (lo === hi) return sortedValues[lo]
  return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * (rank - lo)
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return percentile(sorted, 0.5)
}

function pair(values: number[]): PercentilePair {
  const sorted = [...values].sort((a, b) => a - b)
  return { p50: percentile(sorted, 0.5), p90: percentile(sorted, 0.9) }
}

function pairOrNull(values: Array<number | null | undefined>): PercentilePair | null {
  const filtered = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v))
  return filtered.length === 0 ? null : pair(filtered)
}

function sumOrNull(values: Array<number | null | undefined>): number | null {
  const filtered = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v))
  return filtered.length === 0 ? null : filtered.reduce((acc, v) => acc + v, 0)
}

/**
 * For records with `iteration_index`, split them into visits and compute how
 * many iterations each visit ran.
 *
 * A visit is a contiguous (time-ordered) sequence of records sharing
 * (run_id, node_title) within the bucket where iteration_index starts at 0
 * and grows. When we see iteration_index === 0 again, that's a new visit.
 *
 * Returns null counts when no records in the bucket carry iteration_index —
 * single-shot purposes like `generate-plan-node-text-content` won't have it.
 */
function analyseVisits(records: CallRecord[]): {
  iterations_per_visit: PercentilePair | null
  visits_count: number | null
} {
  const tagged = records.filter((r) => typeof r.iteration_index === "number")
  if (tagged.length === 0) return { iterations_per_visit: null, visits_count: null }

  // Group by (run_id, node_title), sort each group by ts, walk and split into
  // visits on iteration_index === 0 boundaries.
  const groups = new Map<string, CallRecord[]>()
  for (const r of tagged) {
    const k = `${r.run_id}|${r.node_title ?? ""}`
    const arr = groups.get(k) ?? []
    arr.push(r)
    groups.set(k, arr)
  }

  const visitIterations: number[] = []
  for (const arr of groups.values()) {
    arr.sort((a, b) => a.ts.localeCompare(b.ts))
    let currentMax = -1
    for (const r of arr) {
      const idx = r.iteration_index as number
      if (idx === 0 && currentMax !== -1) {
        visitIterations.push(currentMax + 1)
        currentMax = 0
      } else {
        currentMax = Math.max(currentMax, idx)
      }
    }
    if (currentMax !== -1) visitIterations.push(currentMax + 1)
  }

  if (visitIterations.length === 0) return { iterations_per_visit: null, visits_count: null }
  return {
    iterations_per_visit: pair(visitIterations),
    visits_count: visitIterations.length,
  }
}

function keyValue(r: CallRecord, k: BucketKey): string | null {
  switch (k) {
    case "engine":
      return r.engine_id
    case "model":
      return r.model
    case "purpose":
      return r.purpose
    case "node_type":
      return r.node_type
    case "node_title":
      return r.node_title
    case "input_tokens_bucket":
      return inputTokensBucket(r.input_tokens)
  }
}

function aggregate(records: CallRecord[], by: BucketKey[]): BucketStats[] {
  const groups = new Map<string, { records: CallRecord[]; key: Partial<Record<BucketKey, string | null>> }>()
  for (const r of records) {
    const key: Partial<Record<BucketKey, string | null>> = {}
    for (const k of by) key[k] = keyValue(r, k)
    const id = by.map((k) => `${k}=${key[k] ?? "—"}`).join("|")
    const bucket = groups.get(id) ?? { records: [], key }
    bucket.records.push(r)
    groups.set(id, bucket)
  }
  const buckets: BucketStats[] = []
  for (const { records: list, key } of groups.values()) {
    const ok = list.filter((r) => r.success !== false)
    const failed = list.length - ok.length
    const cachedFraction = ok
      .map((r) =>
        r.input_tokens != null && r.input_tokens > 0 && r.cached_prompt_tokens != null
          ? r.cached_prompt_tokens / r.input_tokens
          : null,
      )
      .filter((v): v is number => typeof v === "number")

    const { iterations_per_visit, visits_count } = analyseVisits(ok)
    buckets.push({
      key,
      count: list.length,
      failed,
      duration_ms: pair(ok.map((r) => r.duration_ms)),
      input_tokens: pairOrNull(ok.map((r) => r.input_tokens)),
      output_tokens: pairOrNull(ok.map((r) => r.output_tokens)),
      cached_prompt_tokens: pairOrNull(ok.map((r) => r.cached_prompt_tokens)),
      median_cached_fraction: cachedFraction.length > 0 ? median(cachedFraction) : null,
      instructions_chars: pair(ok.map((r) => r.instructions_chars)),
      input_chars: pair(ok.map((r) => r.input_chars)),
      output_chars: pair(ok.map((r) => r.output_chars)),
      cost_usd: pairOrNull(ok.map((r) => r.cost_usd)),
      total_cost_usd: sumOrNull(ok.map((r) => r.cost_usd)),
      iterations_per_visit,
      visits_count,
    })
  }
  buckets.sort((a, b) => b.count - a.count)
  return buckets
}

// ── Formatting ───────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const sec = Math.round(ms / 1000)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`
  if (m > 0) return `${m}m${String(s).padStart(2, "0")}s`
  return `${s}s`
}

function formatCost(usd: number | null): string {
  if (usd == null) return "—"
  if (usd < 0.001) return `$${usd.toFixed(5)}`
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  if (usd < 1) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

function fmtPercent(v: number | null): string {
  if (v == null) return "—"
  return `${Math.round(v * 100)}%`
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length)
}
function padLeft(s: string, n: number): string {
  return s.length >= n ? s : " ".repeat(n - s.length) + s
}

/**
 * Render a p50–p90 pair through a single-value formatter. Collapses to a
 * single value when p50 === p90 (single sample or degenerate distribution).
 */
function formatPair(p: PercentilePair | null, fmt: (v: number) => string): string {
  if (p == null) return "—"
  const lo = fmt(p.p50)
  const hi = fmt(p.p90)
  return lo === hi ? lo : `${lo}–${hi}`
}
function formatPairInt(p: PercentilePair | null): string {
  return formatPair(p, (v) => String(Math.round(v)))
}
function formatPairDuration(p: PercentilePair | null): string {
  return formatPair(p, formatDuration)
}
function formatPairCost(p: PercentilePair | null): string {
  return formatPair(p, (v) => formatCost(v))
}
function formatPairFloat1(p: PercentilePair | null): string {
  return formatPair(p, (v) => v.toFixed(1))
}

function printTable(by: BucketKey[], buckets: BucketStats[]): void {
  const keyWidths: Partial<Record<BucketKey, number>> = {}
  for (const k of by) {
    keyWidths[k] = Math.max(k.length, ...buckets.map((b) => (b.key[k] ?? "—").length), 3)
  }
  const cols: { name: string; width: number; right: boolean }[] = [
    ...by.map((k) => ({ name: k, width: keyWidths[k]!, right: false })),
    { name: "n", width: 5, right: true },
    { name: "fail", width: 5, right: true },
    { name: "dur p50–p90", width: 14, right: true },
    { name: "in_tok p50–p90", width: 16, right: true },
    { name: "out_tok p50–p90", width: 16, right: true },
    { name: "cached", width: 7, right: true },
    { name: "instr_ch p50–p90", width: 18, right: true },
    { name: "in_ch p50–p90", width: 17, right: true },
    { name: "out_ch p50–p90", width: 17, right: true },
    { name: "cost p50–p90", width: 16, right: true },
    { name: "Σ cost", width: 9, right: true },
    { name: "iter/v p50–p90", width: 14, right: true },
    { name: "visits", width: 7, right: true },
  ]
  function row(values: string[]): string {
    return values.map((v, i) => (cols[i].right ? padLeft(v, cols[i].width) : pad(v, cols[i].width))).join("  ")
  }
  console.log(row(cols.map((c) => c.name)))
  console.log(row(cols.map((c) => "─".repeat(c.width))))
  for (const b of buckets) {
    const values = [
      ...by.map((k) => b.key[k] ?? "—"),
      String(b.count),
      b.failed > 0 ? String(b.failed) : "0",
      formatPairDuration(b.duration_ms),
      formatPairInt(b.input_tokens),
      formatPairInt(b.output_tokens),
      fmtPercent(b.median_cached_fraction),
      formatPairInt(b.instructions_chars),
      formatPairInt(b.input_chars),
      formatPairInt(b.output_chars),
      formatPairCost(b.cost_usd),
      formatCost(b.total_cost_usd),
      formatPairFloat1(b.iterations_per_visit),
      b.visits_count != null ? String(b.visits_count) : "—",
    ]
    console.log(row(values))
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  const opts = parseArgs(process.argv.slice(2))
  const telemetryPath = opts.telemetry ?? defaultTelemetryPath()

  let records: CallRecord[]
  try {
    records = loadTelemetry(telemetryPath)
  } catch (e) {
    console.error(`Failed to read telemetry from ${telemetryPath}: ${(e as Error).message}`)
    console.error("Run a regeneration at least once to populate it.")
    process.exit(1)
  }
  if (records.length === 0) {
    console.error(`Telemetry file ${telemetryPath} is empty.`)
    process.exit(1)
  }

  if (opts.engine) records = records.filter((r) => r.engine_id === opts.engine)
  if (opts.model) records = records.filter((r) => r.model === opts.model)
  if (opts.since) records = records.filter((r) => new Date(r.ts).getTime() >= opts.since!.getTime())

  if (records.length === 0) {
    console.error("No records match the filters.")
    process.exit(1)
  }

  const buckets = aggregate(records, opts.by)

  if (opts.asJson) {
    console.log(JSON.stringify({ source: telemetryPath, records: records.length, by: opts.by, buckets }, null, 2))
    return
  }

  console.log(`Source:  ${telemetryPath}`)
  console.log(`Records: ${records.length}`)
  if (opts.engine) console.log(`Engine:  ${opts.engine}`)
  if (opts.model) console.log(`Model:   ${opts.model}`)
  if (opts.since) console.log(`Since:   ${opts.since.toISOString()}`)
  console.log(`Group by: ${opts.by.join(", ")}`)
  console.log("")
  console.log("Columns: n=successful+failed call count, fail=failed.")
  console.log("  Numeric metrics are shown as p50–p90 (median–90th percentile) — collapsed to one")
  console.log("  value when p50==p90. Specifically: dur=duration, in_tok/out_tok=tokens, instr_ch=")
  console.log("  static prompt template chars, in_ch/out_ch=rendered chars, cost=per-call cost,")
  console.log("  iter/v=iterations per visit (for loops like fix-problems).")
  console.log("  cached=median cached fraction of input, Σ cost=sum across calls in the bucket,")
  console.log("  visits=visit count (number of distinct (run_id, node_title) groups in the bucket).")
  console.log("")
  printTable(opts.by, buckets)
}

main()
