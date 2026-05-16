# Telemetry aggregation: per-call vs per-run

*Last verified: 2026-05-16.*

Two tables hold generation telemetry inside each project's sqlite:

- **`ai_call_stats`** — one row per LLM call. Columns include `run_id`, `duration_ms`, `cost_usd`, `input_tokens`, `output_tokens`, `cached_prompt_tokens`, `purpose`, `node_type`, `node_title`, `reasoning_effort`, `iteration_index`. See [src/backend/db/schema.sql:4](../../src/backend/db/schema.sql#L4).
- **`ai_run_stats`** — one row per generation run (a single "regenerate all" invocation). Columns include `run_id` (unique), `started_at`, `finished_at`, `wall_time_ms`, `total_calls`, `sum_durations_ms`, `cost_usd`. See [src/backend/db/schema.sql:28](../../src/backend/db/schema.sql#L28).

## Invariants (verified against Письмо.sqlite, run 2026-05-16)

For any single `run_id`:
- `ai_run_stats.total_calls` == `COUNT(*)` in `ai_call_stats` for that run_id.
- `ai_run_stats.sum_durations_ms` == `SUM(duration_ms)` in `ai_call_stats` for that run_id.
- `ai_run_stats.wall_time_ms` ≈ `finished_at - started_at` (and ≥ `sum_durations_ms`, since wall-clock includes scheduler overhead between calls). For a sequential single-threaded run, the gap is small — Письмо measured 2,349,641 ms wall vs 2,345,424 ms sum.
- `ai_run_stats.cost_usd` is `SUM(cost_usd)` if every call had a reported cost; otherwise null. Individual `ai_call_stats.cost_usd` are also null when the provider doesn't report cost in its response (xAI sometimes doesn't on smaller models).

## How to aggregate

**Single-run project** (typical for one-shot example generation):
- Validation shortcut — `SELECT COUNT(*), SUM(duration_ms), SUM(cost_usd) FROM ai_call_stats` matches `ai_run_stats` for the only row.

**Multi-run project** (regen-this-node and partial reruns add more `run_id`s):
- For "this project's lifetime totals" (what an MD export usually wants): just sum everything in `ai_call_stats`. Calls from earlier outdated runs are still real money/time spent.
- For "stats of the final successful run": `SELECT ... FROM ai_call_stats WHERE run_id = (SELECT run_id FROM ai_run_stats ORDER BY started_at DESC LIMIT 1)`. Per-run aggregation matters if you want to compare runs or attribute cost to "the run that produced the current artifact".
- Wall-clock time across multiple runs is **not** additive in any meaningful way — separate runs may be hours apart. Use the SUM only as "total time the user spent waiting on this project across all attempts"; for cleaner attribution use the latest run's `wall_time_ms`.

## Cost reliability

`cost_usd` is the provider-reported figure (`reported_cost_usd` from xAI's response stream — see [src/backend/ai/generate-with-telemetry.ts](../../src/backend/ai/generate-with-telemetry.ts)). It's null when the provider omits it. As of 2026-05-16, xAI reports cost on grok-4 family but not consistently on every variant; in Брат 2 only 619 of 899 calls had cost.

When summarising for users, surface the partial-coverage caveat (e.g., "по 619 из 899 вызовов") rather than presenting a sum that silently undercounts.

## Sanity check pattern

For ANY future change to recorder or aggregator, run this against a known-good project DB to confirm invariants still hold:

```bash
node -e "const Database=require('better-sqlite3'); const db=new Database('<path>',{readonly:true}); \
  const callAgg=db.prepare('SELECT COUNT(*) c, SUM(duration_ms) d, SUM(cost_usd) cost FROM ai_call_stats').get(); \
  const runAgg=db.prepare('SELECT SUM(total_calls) c, SUM(sum_durations_ms) d, SUM(cost_usd) cost, SUM(wall_time_ms) wall FROM ai_run_stats').get(); \
  console.log({callAgg, runAgg});"
```

`callAgg.c == runAgg.c`, `callAgg.d == runAgg.d`. If they diverge, a recorder is dropping rows or a run wasn't closed cleanly.
