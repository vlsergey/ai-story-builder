# Node state per iteration — the rework

*2026-09-29. Proposal, nothing implemented; architecture, implementation and UI
all get a review before merge. Motivation: a parallel `for-each` for independent
iterations — saves ~(N−1)/N of a loop's wall-clock time, not money. What it
replaces: [iteration-state-model.md](iteration-state-model.md).*

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
    and `for-each-index` (iterations are independent and keyed by content —
    enforce in the node dictionary); iterations run concurrently under a per-node
    concurrency cap.
  - `for-each-index` (sequential `for-each` only): the index from the last
    segment of the path.

Rows, not the container's JSON: parallel iterations would all rewrite one blob
(the chunk loop's is ~230 KB already), shipped whole in every UI event.

What goes away: mounting, `changeForEachNodePage` as a data operation,
`overrides` and `currentIndex` in container content, `onChildDemoted`. Viewing
an iteration becomes UI state and works during generation. Staleness and
demotion operate over all paths of a node.

**Decided — what the iteration number identifies (2026-09-29).**

- `for-each`: the index, `27:2`. A sequential loop needs the position anyway
  (`for-each-index`, the order `for-each-prev-outputs` reads in), and a changed
  earlier element invalidates everything after it regardless of identity.
- `parallel-for-each`: a hash of the element with dynamic length, `31:a3f9` —
  the shortest prefix that still tells the container's current elements apart,
  growing when it stops doing so. Unchanged elements keep their state when the
  list changes around them.

Consequences for the design:

- The short key is only an address. Growing the length renames rows that already
  exist — `a3f9` becomes `a3f91` — and to know which current element an old key
  belonged to once two of them share it, each iteration must keep the full hash
  of its element. The container renames in one transaction, including every
  nested row under that segment.
- Identical elements are one iteration. They are the same task, and running it
  twice only buys two different random answers to one question; the result fills
  every position the element occupies in the output. So an iteration of a
  parallel container can have several positions — which makes `for-each-index`
  ambiguous there. Forbid it in `parallel-for-each`, as `for-each-prev-outputs`:
  a parallel iteration is identified by content, not by place.
- Elements that disappeared leave rows behind; the container removes them when
  it runs.
- The hash covers the element exactly as received — a whitespace change is a
  change. Output order follows input order; identity does not.

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
