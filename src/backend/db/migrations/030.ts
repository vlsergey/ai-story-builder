import type { Database } from "better-sqlite3"

/**
 * Add `iteration_index` to `ai_call_stats`. Set per-call by callers that loop
 * (currently the fix-problems processor, which fires find- and fix-problems
 * calls up to `maxIterations` times before bailing out below the severity
 * threshold). With this column the aggregator can infer "median fix-iterations
 * per visit" — useful for estimating how many calls a fix-problems node will
 * make in a new template.
 */
export default function migration(db: Database): void {
  db.exec(`ALTER TABLE ai_call_stats ADD COLUMN iteration_index INTEGER`)
}
