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
 *                       model, purpose, node_type, node_title.
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

type BucketKey = "engine" | "model" | "purpose" | "node_type" | "node_title"

const ALLOWED_KEYS: BucketKey[] = ["engine", "model", "purpose", "node_type", "node_title"]

interface BucketStats {
  key: Partial<Record<BucketKey, string | null>>
  count: number
  failed: number
  median_duration_ms: number
  median_input_tokens: number | null
  median_output_tokens: number | null
  median_cached_prompt_tokens: number | null
  median_cached_fraction: number | null
  median_instructions_chars: number
  median_input_chars: number
  median_output_chars: number
  median_cost_usd: number | null
  total_cost_usd: number | null
  /**
   * Median number of iterations per visit, for buckets that include records
   * with `iteration_index`. A "visit" is a contiguous run of records sharing
   * (run_id, node_title) within this bucket whose iteration_index starts at
   * 0; max(iteration_index)+1 within the visit = iterations to converge.
   * `null` when the bucket has no records carrying iteration_index.
   */
  median_iterations_per_visit: number | null
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

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function medianOrNull(values: Array<number | null | undefined>): number | null {
  const filtered = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v))
  return filtered.length === 0 ? null : median(filtered)
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
  median_iterations_per_visit: number | null
  visits_count: number | null
} {
  const tagged = records.filter((r) => typeof r.iteration_index === "number")
  if (tagged.length === 0) return { median_iterations_per_visit: null, visits_count: null }

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

  if (visitIterations.length === 0) return { median_iterations_per_visit: null, visits_count: null }
  return {
    median_iterations_per_visit: median(visitIterations),
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

    const { median_iterations_per_visit, visits_count } = analyseVisits(ok)
    buckets.push({
      key,
      count: list.length,
      failed,
      median_duration_ms: median(ok.map((r) => r.duration_ms)),
      median_input_tokens: medianOrNull(ok.map((r) => r.input_tokens)),
      median_output_tokens: medianOrNull(ok.map((r) => r.output_tokens)),
      median_cached_prompt_tokens: medianOrNull(ok.map((r) => r.cached_prompt_tokens)),
      median_cached_fraction: cachedFraction.length > 0 ? median(cachedFraction) : null,
      median_instructions_chars: Math.round(median(ok.map((r) => r.instructions_chars))),
      median_input_chars: Math.round(median(ok.map((r) => r.input_chars))),
      median_output_chars: Math.round(median(ok.map((r) => r.output_chars))),
      median_cost_usd: medianOrNull(ok.map((r) => r.cost_usd)),
      total_cost_usd: sumOrNull(ok.map((r) => r.cost_usd)),
      median_iterations_per_visit,
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

function printTable(by: BucketKey[], buckets: BucketStats[]): void {
  const keyWidths: Partial<Record<BucketKey, number>> = {}
  for (const k of by) {
    keyWidths[k] = Math.max(k.length, ...buckets.map((b) => (b.key[k] ?? "—").length), 3)
  }
  const cols: { name: string; width: number; right: boolean }[] = [
    ...by.map((k) => ({ name: k, width: keyWidths[k]!, right: false })),
    { name: "n", width: 5, right: true },
    { name: "fail", width: 5, right: true },
    { name: "dur", width: 8, right: true },
    { name: "in_tok", width: 8, right: true },
    { name: "out_tok", width: 8, right: true },
    { name: "cached", width: 7, right: true },
    { name: "instr_ch", width: 8, right: true },
    { name: "in_ch", width: 7, right: true },
    { name: "out_ch", width: 7, right: true },
    { name: "cost", width: 9, right: true },
    { name: "Σ cost", width: 9, right: true },
    { name: "iter/v", width: 7, right: true },
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
      formatDuration(b.median_duration_ms),
      b.median_input_tokens != null ? String(Math.round(b.median_input_tokens)) : "—",
      b.median_output_tokens != null ? String(Math.round(b.median_output_tokens)) : "—",
      fmtPercent(b.median_cached_fraction),
      String(b.median_instructions_chars),
      String(b.median_input_chars),
      String(b.median_output_chars),
      formatCost(b.median_cost_usd),
      formatCost(b.total_cost_usd),
      b.median_iterations_per_visit != null ? b.median_iterations_per_visit.toFixed(1) : "—",
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
  console.log("Columns: n=successful+failed call count, fail=failed, dur=median duration,")
  console.log("  in_tok/out_tok=median tokens, cached=median cached fraction of input,")
  console.log("  instr_ch=median chars of static prompt template, in_ch/out_ch=median rendered chars,")
  console.log("  cost=median per-call cost, Σ cost=sum cost across calls in the bucket,")
  console.log("  iter/v=median iterations per visit (for loops like fix-problems), visits=visit count.")
  console.log("")
  printTable(opts.by, buckets)
}

main()
