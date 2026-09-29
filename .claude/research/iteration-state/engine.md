# Iteration state — engine

*2026-09-29. Part of the architecture proposal for review; see [README.md](README.md).
Interfaces are shapes to agree on, not final code.*

## Paths and state access

```ts
// src/shared/plan-node-path.ts — shared: the UI builds the selected path too
export type NodePath = string                                   // '' | '27:2' | '27:2/40:0'
export interface PathSegment { containerId: number; key: string }
export function childPath(p: NodePath, containerId: number, key: string | number): NodePath
export function parentPath(p: NodePath): NodePath
export function truncatePath(p: NodePath, depth: number): NodePath
export function lastSegment(p: NodePath): PathSegment | null
export function isAtOrBelow(p: NodePath, ancestor: NodePath): boolean

// src/backend/plan/nodes/plan-node-state-repository.ts
export class PlanNodeStateRepository {
  find(nodeId: number, path: NodePath): PlanNodeStateRow | undefined
  findAtOrBelow(nodeIds: number[] | null, ancestor: NodePath): PlanNodeStateRow[]
  upsert(nodeId: number, path: NodePath, f: PlanNodeStateUpdate): PlanNodeStateRow  // whitelisted columns
  setStatus(nodeIds: number[], ancestor: NodePath, from: PlanNodeStatus[], to: PlanNodeStatus): PlanNodeStateRow[]
  deleteAtOrBelow(nodeIds: number[] | null, ancestor: NodePath): number
  renameKey(parent: NodePath, containerId: number, from: string, to: string): number  // nested rows too
}
```

`PlanNodeRow` survives as the **composed view** — definition + state at a path +
the path — so most consumers keep their shape. Multi-row operations run in a real
`db.transaction`; today `withDbWrite` is a pass-through and nothing is transactional.

## Processors

```ts
export interface NodeProcessor<S = unknown> {
  readonly defaultSettings: S
  getOutput(service: PlanNodeService, node: PlanNodeRow /* state@path */, path: NodePath): unknown
  onInputContentChange?(service, node, path, changedInputNodeId, settings): Promise<PlanNodeStateUpdate | null>
  regenerate?(service, context: RegenerationNodeContext /* carries path */, node, settings): Promise<PlanNodeStateUpdate | null>
}
export interface ContainerProcessor<S = unknown> extends NodeProcessor<S> {
  iterations(service, container: PlanNodeRow, path: NodePath): RegenerationIteration[] // output order
  onChildStateChanged(service, container, path, childId: number, childPath: NodePath): Promise<void>
}
export interface RegenerationIteration { key: string; positions: number[] }  // >1 position when deduplicated
```

- `regenerate` returns a **state-only** patch. Today lore, for-each and
  for-each-output return whole rows, so the patch carries `x`/`y`/`id`/`type` and
  never cascades; returning state only makes a finished container cascade — a
  deliberate behaviour change, covered by tests.
- `onUpdate` (for-each-output) and `onChildDemoted` (for-each) go away;
  `onChildStateChanged` replaces both.
- `for-each-prev-outputs` reads the output node at `P/C:0 … P/C:(i−1)`, `i` from
  its own last segment. `for-each-index` is its last segment + 1, no DB read.

## Generation functions take resolved inputs

`generatePlanNodeTextContent`, `generateSplitParts`, `findProblems`,
`fixProblems` stop creating `new PlanNodeService()` and take `NodeInputs<string>`
resolved by their processor at its path (plus `inputToFix` for find/fix). They
then need no path at all, so no call site can silently resolve at `''` and read
another iteration. fix-problems stops re-resolving its inputs up to
`1 + 2 × maxIterations` times per visit and sees one snapshot. `NodeInput` gains
`sourcePath`; its `sourceNode` is the source's state at that path (split and
fix-problems copy its `summary`).

## Input resolution and edge shapes

A consumer at path `P` reads source `X` at `truncatePath(P, depth(X))`.

| edge | source read at |
|---|---|
| siblings | `P` |
| outside → inside | a shorter prefix of `P` (a root node reads `''`) |
| container → outside | `P`; the container aggregates its children at `P/C:k` |
| into a container (textArray) | a prefix of `P`; the container writes its input rows |
| inside → outside, skipping the container | **rejected** |
| across two sibling loops | **rejected** |

Today all six are accepted — `canCreateEdge` checks types only — and the last two
read whichever page is mounted. The fiction-arc templates use none of them.
Rejection is enforced on the server (edge routes, template apply and update), as
is `allowedContainers`, which the backend does not check today; the parallel
container's ban on `for-each-prev-outputs` and `for-each-index` depends on it.

## Writes and the cascade

`patch` splits in two:

- `patchState(id, path, manual, data)` — today's status rules per `(node, path)`,
  counts recomputed, then the cascade from `(X, P)`.
- `patchDefinition(id, data)` — a settings change demotes every row of the node;
  a parent change deletes the moved subtree's rows.

Cascade from `(X, P)`: consumers in X's scope at `P`; consumers inside a loop fed
from outside at every row at or below `P`; if X's parent is a container,
`onChildStateChanged` — the output child cascades from the container at
`parentPath(P)`, and a sequential loop demotes prev-outputs at later iterations.
It never crosses into a sibling iteration. Which state keys cascade is decided
explicitly, instead of today's "every key outside `DO_NOT_NOTIFY`", where one
excluded key cancels the cascade for a whole patch.

## Staleness propagation

`propagateStaleStatus` iterates over state rows: forward resolves each source at
the consumer's path (a source outside a loop feeds every iteration); bottom-up
promotes `(C, P)` if any child row at `P/C:k` is stale **for C's current keys
only**, missing rows counting as pending; top-down into `(for-each-input, P/C:k)`
for all k; and prev-outputs at `P/C:j` depends on the output at `P/C:k`, `k < j`.
It writes processing state only, in batches, emitting events with paths.

## Scheduler and concurrency

- The path lives **in the regeneration context**; only the cycle context's
  `asContainers(iterations, concurrency, block)` builds child paths, so the
  scheduler and the path cannot disagree. It waits for every started iteration to
  settle, then rethrows the first error — otherwise the run's `finally` would
  clear `inProcess` while branches still write.
- Concurrency: a per-node cap on `parallel-for-each` (default 4) **and** a
  run-wide cap on concurrent LLM calls, engine-aware — nested caps multiply, and
  Ollama is a shared daemon (cap 1 there).
- The progress stack becomes a **tree of frames**, one per context — no LIFO for
  parallel branches to corrupt. Events carry `{id, title, type}` refs and paths,
  not full rows, and are copied when emitted (today they reference the live array).
- `regenerateTreeNodesContents(target?: {nodeId, path})`.
- `computeLevelDependencies` runs once per container per run, not per iteration.
- Dead code goes: `nodeContext.asContainer`, `onNodeUpdated`, `getNodeOutput`,
  `NodeUpdateEvent`, `PlanNodeSubscriptionEvent`.

## Telemetry

`ai_call_stats` gains nullable `node_id` and `path`, set through an
AsyncLocalStorage value owned by the node context. `iteration_index` stays what it
is — the fix-problems loop counter. `promptCacheKeys` stays `[purpose, nodeId]`:
it is a prefix-cache hint, and iterations share the prefix. Parallel runs break
the `wall_time ≥ sum(durations)` invariant and the visit split in
`scripts/aggregate-telemetry.ts`; both key on the path from then on.
