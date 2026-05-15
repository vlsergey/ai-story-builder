import type { Database } from "better-sqlite3"

/**
 * Add `reasoning_effort` to `ai_call_stats`. Reasoning models bill reasoning
 * tokens separately and their cost/duration scales with effort level. Without
 * splitting by this dimension, p50–p90 ranges for the same (engine, model,
 * purpose) bucket mix "low" and "high" calls and look spuriously wide.
 *
 * Stored as TEXT — values are "low" or "high" today (per xAI), null when
 * the call didn't carry the setting (non-reasoning model or default).
 */
export default function migration(db: Database): void {
  db.exec(`ALTER TABLE ai_call_stats ADD COLUMN reasoning_effort TEXT`)
}
