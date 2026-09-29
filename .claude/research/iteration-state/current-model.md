# Iteration state — the current model

*2026-09-29. How `for-each` kept its children's state **before phase 1** and what
that cost. Replaced on `iteration-state` (`f9ac300`); kept because migration 033
reads this layout. Line pointers are to `master` before the rework.*

## Mounting an iteration into the definition rows

`plan_nodes` ([schema.sql:100](../../../src/backend/db/schema.sql)) mixes a node's
definition (`parent_id`, `title`, `type`, `position`, `x`/`y`/`width`/`height`,
`node_type_settings`, `ai_settings`) with its state (`content`, `summary`,
`status`, counts, `in_review`, `review_base_content`, `ai_improve_instruction`).

A `for-each` keeps per-iteration snapshots of its **direct** children in its own
content as `overrides[i][childId]`
([for-each-plan-node.ts](../../../src/shared/for-each-plan-node.ts)).
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
- **The editor keeps the iteration it loaded.** It re-syncs only after its own
  generate or improve (`PlanNodeEditor.tsx:72-75,113-116`). After a page switch it
  still shows the previous iteration, and a content edit saves that iteration's
  text, edited, onto the newly mounted one; a prompt-only edit writes just the
  prompt, since it saves a diff (`:83`).
- **Review state ignores iterations.** A review started on page 2 is still open on
  page 3, against page 2's base content.
- **Only the mounted iteration hears about changes from outside the loop.** An
  upstream edit reaches a loop child through the cascade
  (`plan-node-service.ts:201-232`), a prompt edit demotes it directly (`:416-418`),
  and both touch the mounted row only. Other iterations keep GENERATED snapshots,
  which the scheduler skips. Only template updates mirror a demotion into every
  snapshot, through `demoteToOutdated` → `onChildDemoted`
  (`template-update.ts:374,442`). Each fiction-arc template has 25 edges entering
  a loop from outside (Style → Chunk prose, World → Character profile, …); in the
  chunk loop later iterations still re-run through the prev-outputs chain,
  earlier ones never do.
- **Staleness is seen for the mounted iteration only.** `propagateStaleStatus`
  checks child rows ([propagateStaleStatus.ts:163](../../../src/backend/plan/nodes/generate/propagateStaleStatus.ts));
  an ERROR in `overrides[2]` with page 0 mounted never promotes the container.
- **The mounted snapshot is stale by design.** `overrides[currentIndex]` is written
  on page change, so the live state of the current page is in the rows. In local
  projects 7 of 18 containers disagree, in both directions.
- **Output length is the snapshot count, not `length`.** `getOutput` maps over
  `overrides`; one local project has 25 snapshots against `length` 24, and the
  extra output reaches a downstream merge. It also compares strictly with
  `currentIndex`, so while that is unset it reads every iteration from snapshots;
  every other reader treats unset as 0.
- **Nested loops don't work.** Only direct children are snapshotted: an inner
  container's own content, snapshots included, is swapped per outer iteration,
  but the inner loop's mounted child rows are shared by every outer iteration. No
  template nests loops.

## Who touches it

`ForEachProcessor` (`getOutput` reads rows for the mounted page and snapshots for
the rest), the `for-each-prev-outputs` and `for-each-index` processors,
`for-each-output`'s `onUpdate`, `changeForEachNodePage` and the pager,
`template-update.ts` (its demotions rewrite snapshots through `onChildDemoted`),
`apply-project-template.ts` (writes initial child state), and the scripts
`switch-foreach-iteration`, `dump-node`, `export-ready-chunks`,
`export-project-to-md`. Migration 032 and `export-project-as-template` do not:
032's "overrides" are per-node AI settings, and export reads definitions only.
The full list of what goes: [removals.md](removals.md).
