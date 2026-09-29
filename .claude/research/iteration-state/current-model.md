# Iteration state — the current model

*2026-09-29. How `for-each` keeps its children's state today, and what that costs.
The proposal that replaces it: [README.md](README.md).*

## Mounting an iteration into the definition rows

`plan_nodes` ([schema.sql:100](../../../src/backend/db/schema.sql)) mixes a node's
definition (`parent_id`, `title`, `type`, `position`, `x`/`y`/`width`/`height`,
`node_type_settings`, `ai_settings`) with its state (`content`, `summary`,
`status`, counts, `in_review`, `review_base_content`, `ai_improve_instruction`).

A `for-each` keeps per-iteration snapshots of its children in its own content as
`overrides[i][childId]` ([for-each-plan-node.ts](../../../src/shared/for-each-plan-node.ts)).
`NodeOverride` covers content, summary, counts and status — **not** the review
fields. Running iteration `i` means *mounting* it: `changeForEachNodePage`
([plan-node-service.ts:596](../../../src/backend/plan/nodes/plan-node-service.ts))
saves the children's rows into `overrides[currentIndex]` and writes `overrides[i]`
onto them ([plan-node-repository.ts:12,45](../../../src/backend/plan/nodes/plan-node-repository.ts)).
Children then run against the shared rows
([for-each-processor.ts:151](../../../src/backend/plan/nodes/graph/for-each-processor.ts)).
In local projects these blobs run from 8 KB to 3.7 MB.

## What it costs

- **Sequential by construction.** One set of child rows, one mounted iteration.
- **Viewing an iteration is a DB write.** The pager calls `forEachNodes.changePage`
  ([router.ts:137](../../../src/backend/router.ts)) and is disabled while the
  container is GENERATING — switching would clobber the running iteration.
- **Single-node actions don't lock the pager.** Regenerate or improve a child,
  switch pages, and the result lands in the newly mounted iteration.
- **The editor writes the wrong iteration.** It never re-syncs from the server
  (`useState(initialValue)`, `PlanNodeEditor.tsx:72-75`), so after a page switch its
  next save writes the old iteration's text onto the new one.
- **Review state ignores iterations.** A review started on page 2 is still open on
  page 3, against page 2's base content.
- **Staleness is seen for the mounted iteration only.** `propagateStaleStatus`
  checks child rows ([propagateStaleStatus.ts:163](../../../src/backend/plan/nodes/generate/propagateStaleStatus.ts));
  an ERROR in `overrides[2]` with page 0 mounted never promotes the container.
- **Compensating hooks.** `onChildDemoted` exists to mirror a demotion into every
  snapshot, because the rows hold only one.
- **The mounted snapshot is stale by design.** `overrides[currentIndex]` is written
  on page change, so the live state of the current page is in the rows. In local
  projects 7 of 18 containers disagree, in both directions.
- **Output length is the snapshot count, not `length`.** `getOutput` maps over
  `overrides`; one local project has 25 snapshots against `length` 24, and the
  extra output reaches a downstream merge.
- **Nested loops don't work.** Mounting touches direct children only, so an inner
  loop's children are shared by every outer iteration. No template nests loops.

## Who touches it

`ForEachProcessor` (`getOutput` reads rows for the mounted page and snapshots for
the rest), the `for-each-prev-outputs` and `for-each-index` processors,
`for-each-output`'s `onUpdate`, `changeForEachNodePage` and the pager,
`template-update.ts` (its demotions rewrite snapshots through `onChildDemoted`),
`apply-project-template.ts` (writes initial child state), and the scripts
`switch-foreach-iteration`, `dump-node`, `export-ready-chunks`,
`export-project-to-md`. Migration 032 and `export-project-as-template` do not:
032's "overrides" are per-node AI settings, and export reads definitions only.
