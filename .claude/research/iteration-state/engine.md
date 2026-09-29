# Iteration state — engine

*2026-09-29, revised after review. Part of the architecture proposal; see [README.md](README.md).
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
  upsert(nodeId: number, path: NodePath, f: PlanNodeStateUpdate, expectedRev?: string): PlanNodeStateRow | null
  setStatus(nodeIds: number[], ancestor: NodePath, from: PlanNodeStatus[], to: PlanNodeStatus): PlanNodeStateRow[]
  deleteAtOrBelow(nodeIds: number[] | null, ancestor: NodePath): number
  renameKey(parent: NodePath, containerId: number, from: string, to: string): number  // nested rows too
}
```

`PlanNodeRow` survives as the **composed view** — definition + state at a path +
the path — so most consumers keep their shape. Multi-row operations run in a real
`db.transaction`; no plan-node write does today (`withDbWrite` is a pass-through;
only migration steps and lore reordering use transactions).

## Write ordering

A generation takes minutes, and its row may change meanwhile: a prompt edit
demotes it, an upstream edit drops its iteration, the user deletes the node.
Today the result lands regardless (phase 0 #16); with parallel branches and
editing during runs it would land on demoted rows, on vanished paths, over MANUAL
text.

- Every state row carries `rev`, replaced by a fresh random value on every write,
  demotion and rename. It is never reused, so a deleted and re-created row cannot
  match an old one.
- Regenerate, improve and editor saves send the `rev` they started from, and the
  write is compare-and-set. A generation or improve that loses is dropped and
  counted in the run's progress; the row keeps the newer write. An editor that
  loses gets a conflict and reloads.
- `upsert` refuses a path whose segments are not the containers' current keys,
  so nothing is written under a vanished or renamed iteration.

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
- **A container expands its input at the start of its own run**, when none of its
  branches runs: it resolves its inputs at its path, writes the `for-each-input`
  rows of new or changed elements, deletes vanished iterations and grows keys —
  idempotently. Its `onInputContentChange` only demotes it. Today expansion lives
  in `onInputContentChange`; kept there, an inner loop fed from outside the outer
  loop would never be expanded for a new outer iteration.
- `onUpdate` (for-each-output) and `onChildDemoted` (for-each) go away;
  `onChildStateChanged` replaces both.
- `for-each-prev-outputs` reads the output node at `P/C:0 … P/C:(i−1)`, `i` from
  its own last segment. `for-each-index` is its last segment + 1, no DB read.

## Generation functions take resolved inputs

`generatePlanNodeTextContent`, `generateSplitParts`, `findProblems`,
`fixProblems` and `improvePlanNodeContent` stop reading rows by id and take
`NodeInputs<string>` resolved by their caller at its path (plus `inputToFix` for
find/fix, the content and instruction for improve). No call site can then resolve
at `''` and read another iteration. fix-problems stops re-resolving its inputs up
to `1 + 2 × maxIterations` times per visit. `NodeInput` gains `sourcePath`; its
`sourceNode` is the source's state at that path (split, merge, fix-problems and
for-each-output copy its `summary`).

## Input resolution and edge shapes

A consumer at path `P` reads source `X` at `truncatePath(P, depth(X))`.

| edge | source read at |
|---|---|
| siblings | `P` |
| outside → inside | a shorter prefix of `P` (a root node reads `''`) |
| container → outside | `P`; the container aggregates its children at `P/C:k` |
| into a container (textArray) | a prefix of `P`; the container expands it |
| inside → outside, skipping the container | **rejected** |
| across two sibling loops | **rejected** |

Today all six are accepted — `canCreateEdge` checks types only — and the last two
read whichever page is mounted. The fiction-arc templates use none of them.
Rejection is enforced on the server — edge routes, template apply and update, and
reparenting, which can turn an existing edge into a rejected shape — as is
`allowedContainers`, which the backend does not check today; the parallel
container's ban on `for-each-prev-outputs` and `for-each-index` depends on it.

The rest of the engine — writes, the cascade, staleness propagation, the
scheduler and telemetry — is in [cascade.md](cascade.md).
