# Node state per iteration — the current model

*2026-09-29. How `for-each` keeps its children's state today, and what that costs.
The rework that replaces it: [iteration-state-rework.md](iteration-state-rework.md).*

## Current model: mount an iteration into the definition rows

`plan_nodes` ([schema.sql:100](../../src/backend/db/schema.sql)) mixes two things:
definition (`parent_id`, `title`, `type`, `position`, `x`/`y`/`width`/`height`,
`node_type_settings`, `ai_settings`) and state (`content`, `summary`, `status`,
`word_count`/`char_count`/`byte_count`, `in_review`, `review_base_content`,
`ai_improve_instruction`).

A `for-each` keeps per-iteration snapshots of its children's state in its own
content as `overrides[i][childId]` ([for-each-plan-node.ts](../../src/shared/for-each-plan-node.ts)
— `NodeOverride` is exactly the state columns). Running iteration `i` means
*mounting* it: `changeForEachNodePage` ([plan-node-service.ts:596](../../src/backend/plan/nodes/plan-node-service.ts))
saves the children's rows into `overrides[currentIndex]`
(`collectForEachNodeIterationContentFromChildren`, [plan-node-repository.ts:45](../../src/backend/plan/nodes/plan-node-repository.ts))
and writes `overrides[i]` back onto the rows (`applyForEachNodeIterationToChildren`,
[:12](../../src/backend/plan/nodes/plan-node-repository.ts)). Children then run
against the shared rows ([for-each-processor.ts:151](../../src/backend/plan/nodes/graph/for-each-processor.ts)).

Consequences, all visible in the code:

- **Sequential by construction.** One set of child rows, one mounted iteration.
- **Viewing an iteration is a DB write.** The pager ([ForEachPlanNodeFooter.tsx](../../src/frontend/src/plan/plan-graph/ForEachPlanNodeFooter.tsx))
  calls `forEachNodes.changePage` ([router.ts:137](../../src/backend/router.ts)),
  and is disabled while the container is `GENERATING` — switching would clobber
  the running iteration.
- **Staleness is seen for the mounted iteration only.** `propagateStaleStatus`
  checks child *rows* ([propagateStaleStatus.ts:163](../../src/backend/plan/nodes/generate/propagateStaleStatus.ts));
  an ERROR in `overrides[2]` with page 0 mounted never promotes the container.
- **Compensating hooks.** `onChildDemoted` ([node-processor.ts:71](../../src/backend/plan/nodes/graph/node-processor.ts))
  exists to mirror a demotion into every snapshot, because the rows only hold one.
- **The mounted snapshot can be stale.** `overrides[currentIndex]` is written on
  page change, so the live state of the current page is in the rows, not there.

Other consumers of the model: `for-each-prev-outputs` and `for-each-index`
processors, `ForEachProcessor.getOutput` (reads rows for the current page,
snapshots for the rest), `template-update.ts`, `apply-project-template.ts`,
`export-project-as-template.ts`, migration 032.
