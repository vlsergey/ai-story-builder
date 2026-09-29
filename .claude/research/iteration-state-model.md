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
- `plan_node_states (node_id, path, content, summary, status, word/char/byte
  counts, review fields, PK(node_id, path))` — the one home of all state, root
  nodes included.
- `path` is hierarchical and names both the container and the iteration at every
  level: `''` at the root, `'27:2'` for a child of loop #27 in its iteration 2,
  `'27:2/40:0'` one level deeper. Container ids make the key self-describing and
  unambiguous for nested loops, and "everything loop #27 produced in iteration 2"
  is `path = '27:2' OR path LIKE '27:2/%'` (a bare prefix would also match `27:20`).
- **State is read and written through the parent container.** Root nodes are
  children of an implicit root container. Only a container knows its iterations,
  so only a container builds its children's paths: `P + '/27:i'`.
- **A container stores no state of its children.** The `overrides` snapshots go
  away entirely. A container's own row holds its own status and iteration count;
  its output is read from its output node's rows across its iterations.
- Input resolution: a consumer at path `P` reads a source `X` at the prefix of
  `P` made of the segments of `X`'s container ancestors — siblings share `P`, a
  node outside the loop drops the loop's segment, a root node reads `''`.
- Containers own iteration semantics:
  - `for-each`: iterations in order; `for-each-prev-outputs` reads the output
    node at `P/27:0 … P/27:(i−1)`.
  - `parallel-for-each` (new): same children types minus `for-each-prev-outputs`
    (iterations are independent — enforce in the node dictionary); iterations run
    concurrently under a per-node concurrency cap.
  - `for-each-index`: the iteration number from the last segment of the path.

Why rows, not the container's JSON: parallel iterations would all rewrite one
blob (the chunk loop's content is already ~230 KB), and every patch would ship
the whole blob in UI events.

What goes away: mounting, `changeForEachNodePage` as a data operation,
`overrides` and `currentIndex` in container content, `onChildDemoted`. Viewing
an iteration becomes UI state and works during generation. Staleness and
demotion operate over all paths of a node.

**Open — what the iteration number identifies.** Today it is the position in the
input list, as `overrides[i]` is. Inserting an element in the middle then puts
every later element's state under the wrong path. The container re-runs on input
change anyway, so positional keys are safe — but wasteful: a stable per-element
identity (e.g. a hash of the element) would let unchanged elements keep their
state. For a sequential loop that only holds while every earlier element is also
unchanged, because of `for-each-prev-outputs`. Settle before the migration fixes
the key format.

### Two kinds of status — never the same thing

- **Processing state** — per `(node, path)` in `plan_node_states`. The only thing
  processors, the scheduler, staleness propagation and invalidation read or write.
- **Display state** — derived, per UI view, never stored as node data:
  - a container child shows the state at the iteration selected in the UI; that
    selection is view state (client side), and changing it writes nothing;
  - a container shows an aggregate over its children's paths (any running →
    running, any error → error, any stale → stale, all generated → generated),
    optionally with counts — e.g. "3/4 generated, 1 running".

Today the two are the same rows: the mounted page is both what the UI shows and
what `propagateStaleStatus` reads, so the page a user happens to have open
decides whether the container looks stale to the scheduler.

### Nesting

Must stay allowed — `for-each` has no `allowedContainers` in the node dictionary
today, so loops can nest. The path covers it by construction: a container at
path `P` gives its children `P/<id>:i`, and a nested container extends it again.
The migration has to follow suit: an inner container's snapshot lives inside the
outer one's `overrides`.

## Blast radius

- Every processor: `getOutput(service, node, path)`; `regenerate` gets the path
  through its context; `findNodeInputs(nodeId, path)`.
- Generation functions stop creating their own `new PlanNodeService()`
  (`generate-plan-node-text-content.ts`, `generate-fix-problems.ts`,
  `generate-split-parts.ts`, …) and take service + path.
- Scheduler: `regenerateSubtreeNodesContents(context, parentId, path)`; the
  progress stack becomes per branch — its single-path check in `onNodeStart`
  cannot hold with concurrent iterations.
- `propagateStaleStatus`, cascade on patch, `demoteToOutdated`, template update.
- Frontend: to limit churn, the backend can keep returning a composed
  `definition + state@path` row, root path by default, path as an optional query
  parameter for container children. Node update events carry the path.
- Migration: root state → path `''`; for each container, `overrides[i]` for
  `i ≠ currentIndex` and the live child rows for `currentIndex` (the snapshot of
  the mounted page can be stale); recursive for nested containers; then drop the
  state columns from `plan_nodes` and `overrides`/`currentIndex` from containers.
- Template update cannot change a node's type today; moving an existing
  project's loop to `parallel-for-each` needs that, or a one-off migration.

## Suggested order

1. State table + path API, `for-each` moved onto it with no behaviour change.
   The risky phase — the scheduler is where the forward-EMPTY invalidation bug
   lived.
2. `parallel-for-each` on top — small once (1) exists.
3. fiction-arc: character loop → `parallel-for-each`.
