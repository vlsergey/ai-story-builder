# Node state per iteration — current model and proposed rework

*2026-09-29. Status: proposal under discussion, nothing implemented. Motivation: a
parallel counterpart of `for-each` for independent iterations (fiction-arc's
character loop: 2–4 characters, 6–22 min sequential per run, ~(N−1)/N of that
saved in wall-clock time — not money: same calls, and slightly worse prompt-cache
hits when calls start together).*

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

## Proposal: definitions and state in separate tables, state via the parent container

- `plan_nodes` — definitions only; read from the DB as today.
- `plan_node_states (node_id, scope, content, summary, status, word/char/byte
  counts, review fields, PK(node_id, scope))` — every piece of state, root nodes
  included.
- **State is read and written through the parent container.** Root nodes are
  children of an implicit root container. A container turns "child X in
  iteration i" into a scope; `scope` is the path of iteration indices through the
  enclosing containers: `''` at the root, `'2'` inside a loop, `'2/0'` nested.
- Input resolution: a consumer at scope `S` reads source `X` at `S` truncated to
  `X`'s own depth (number of container ancestors). Siblings share the scope;
  outside nodes resolve up the chain.
- Containers own iteration semantics:
  - `for-each`: iterations in order; `for-each-prev-outputs` reads the output
    node at scopes `S/0 … S/(i−1)` — from the container, not from a snapshot blob.
  - `parallel-for-each` (new): same children types minus `for-each-prev-outputs`
    (iterations are independent — enforce in the node dictionary); iterations run
    concurrently under a per-node concurrency cap.
  - Container output: the output node's state collected across its scopes.

Why rows, not the container's JSON: parallel iterations would all rewrite one
blob (the chunk loop's content is already ~230 KB), and every patch would ship
the whole blob in UI events.

What goes away: mounting, `changeForEachNodePage` as a data operation,
`overrides`/`currentIndex` in container content, `onChildDemoted`. Viewing an
iteration becomes UI state and works during generation. Staleness and demotion
operate over all scopes of a node.

### Two kinds of status — never the same thing

- **Processing state** — per `(node, scope)` in `plan_node_states`. The only thing
  processors, the scheduler, staleness propagation and invalidation read or write.
- **Display state** — derived, per UI view, never stored as node data:
  - a container child shows the state at the iteration selected in the UI; that
    selection is view state (client side), and changing it writes nothing;
  - a container shows an aggregate over its children's scopes (any running →
    running, any error → error, any stale → stale, all generated → generated),
    optionally with counts — e.g. "3/4 generated, 1 running".

Today the two are the same rows: the mounted page is both what the UI shows and
what `propagateStaleStatus` reads, so the page a user happens to have open
decides whether the container looks stale to the scheduler.

### Nesting

Must stay allowed — `for-each` has no `allowedContainers` in the node dictionary
today, so loops can nest. The scope path covers it by construction: a container
at scope `S` gives its children scopes `S/i`; a nested container extends the
path again. The migration has to follow suit: an inner container's snapshot
lives inside the outer one's `overrides`.

## Blast radius

- Every processor: `getOutput(service, node, scope)`; `regenerate` gets the
  scope through its context; `findNodeInputs(nodeId, scope)`.
- Generation functions stop creating their own `new PlanNodeService()`
  (`generate-plan-node-text-content.ts`, `generate-fix-problems.ts`,
  `generate-split-parts.ts`, …) and take service + scope.
- Scheduler: `regenerateSubtreeNodesContents(context, parentId, scope)`; the
  progress stack becomes per branch — its single-path check in `onNodeStart`
  cannot hold with concurrent iterations.
- `propagateStaleStatus`, cascade on patch, `demoteToOutdated`, template update.
- Frontend: to limit churn, the backend can keep returning a composed
  `definition + state@scope` row, root scope by default, scope as an optional
  query parameter for container children. Node update events carry the scope.
- Migration: root state → scope `''`; for each container, `overrides[i]` for
  `i ≠ currentIndex` and the live child rows for `currentIndex`; recursive for
  nested containers; then drop the state columns from `plan_nodes`.
- Template update cannot change a node's type today; moving an existing
  project's loop to `parallel-for-each` needs that, or a one-off migration.

## Suggested order

1. State table + scope API, `for-each` moved onto it with no behaviour change.
   The risky phase — the scheduler is where the forward-EMPTY invalidation bug
   lived.
2. `parallel-for-each` on top — small once (1) exists.
3. fiction-arc: character loop → `parallel-for-each`.
