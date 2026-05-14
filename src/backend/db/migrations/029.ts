import type { Database } from "better-sqlite3"

/**
 * Add per-call (`ai_call_stats`) and per-run (`ai_run_stats`) telemetry tables.
 *
 * Per-call rows are written on every LLM API invocation. Per-run rows are
 * written once at the end of a `regenerateTreeNodesContents` cycle and
 * summarise it. Both tables are append-only from the app's POV; the same data
 * is mirrored to a JSONL file in user-data for cross-project aggregation by
 * the template-duration estimator. Local-only — nothing leaves the user's disk.
 */
export default function migration(db: Database): void {
  db.exec(`
    CREATE TABLE ai_call_stats (
      id INTEGER PRIMARY KEY,
      ts DATETIME NOT NULL,
      run_id TEXT NOT NULL,
      engine_id TEXT NOT NULL,
      model TEXT NOT NULL,
      purpose TEXT NOT NULL,
      prompt_cache_keys TEXT,
      node_title TEXT,
      node_type TEXT,
      instructions_chars INTEGER NOT NULL,
      input_chars INTEGER NOT NULL,
      output_chars INTEGER NOT NULL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cached_prompt_tokens INTEGER,
      duration_ms INTEGER NOT NULL,
      cost_usd REAL,
      success INTEGER NOT NULL,
      error_message TEXT
    );
    CREATE INDEX idx_ai_call_stats_run ON ai_call_stats (run_id);
    CREATE INDEX idx_ai_call_stats_lookup ON ai_call_stats (node_type, purpose, engine_id, model);

    CREATE TABLE ai_run_stats (
      id INTEGER PRIMARY KEY,
      run_id TEXT NOT NULL UNIQUE,
      started_at DATETIME NOT NULL,
      finished_at DATETIME,
      wall_time_ms INTEGER,
      template_file TEXT,
      engine_id TEXT,
      model TEXT,
      total_calls INTEGER NOT NULL DEFAULT 0,
      calls_by_purpose TEXT,
      sum_durations_ms INTEGER NOT NULL DEFAULT 0,
      total_input_tokens INTEGER,
      total_output_tokens INTEGER,
      total_cached_prompt_tokens INTEGER,
      cost_usd REAL,
      success INTEGER NOT NULL DEFAULT 1
    );
  `)
}
