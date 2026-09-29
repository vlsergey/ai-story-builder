# Iteration state — what goes away

*2026-09-29, revised after review. Part of the architecture proposal; see
[README.md](README.md). Every pointer below was checked against `master` at `1eebc0e`.*

## Hacks the rework straightens out

Each is a workaround for one fact: a `for-each`'s iterations share one set of
child rows. With state keyed by `(node, path)` the reason for each disappears.

1. **Mounting.** Running or viewing iteration `i` copies the children's rows into
   `overrides[currentIndex]` and `overrides[i]` onto the rows
   (`changeForEachNodePage`, `plan-node-service.ts:596-633`;
   `applyForEachNodeIterationToChildren` and
   `collectForEachNodeIterationContentFromChildren`, `plan-node-repository.ts:12-64`).
   → Each iteration's state is its own rows; nothing is copied.
2. **Viewing is a write.** The pager calls `forEachNodes.changePage`
   (`router.ts:135-137`, `ForEachPlanNodeFooter.tsx:14-26`) and is disabled while
   GENERATING, because switching would clobber the running iteration.
   → Selection is client view state.
3. **Two sources of truth, several rules.** The mounted iteration lives in the
   rows, the others in snapshots, and each reader decides on its own which is
   which: `getOutput` compares strictly with `currentIndex`
   (`for-each-processor.ts:39`), so an unset index sends every iteration to the
   snapshots, while `changeForEachNodePage`, `onInputContentChange`, prev-outputs,
   `dump-node.ts:180` and `export-ready-chunks.ts:108` treat unset as 0. In local
   projects 7 of 18 containers disagree with themselves. → One row per
   `(node, path)`.
4. **Output length is the snapshot count**, not `length`
   (`for-each-processor.ts:38`): 25 outputs for 24 elements in one project.
   → Iterate `0..length-1`.
5. **Demotions mirrored into snapshots — sometimes.** `NodeProcessor.onChildDemoted`
   (`node-processor.ts:59-71`), its for-each implementation
   (`for-each-processor.ts:174-195`) and the walk that calls it
   (`demoteToOutdated`, `plan-node-service.ts:164-193`) exist so that a page switch
   does not resurrect GENERATED content; only template updates use them (phase 0
   #14). The snapshot rewrite goes through `patch`, which marks the container
   GENERATED and cascades before the walk demotes it again (`:402-413`).
   → A definition change demotes every path of the node in one statement.
6. **JSON surgery in SQL.** `for-each-output`'s `onUpdate`
   (`for-each-output-processor.ts:33-44`) runs a 40-line CTE
   (`updateForEachPrevOutputsStatusInsideForEachContent`,
   `plan-node-repository.ts:222-268`) that rewrites the snapshot status of
   `for-each-prev-outputs` in every iteration after `currentIndex`.
   → An ordinary dependency: prev-outputs at `C:j` reads the output at
   `C:0..j-1`, and the scoped cascade demotes it.
7. **Seeding every child to make resets work.** `onInputContentChange` writes an
   entry for every child in every iteration only so that mounting resets them,
   marks every iteration's input OUTDATED whether its element changed or not, and
   patches the mounted input row separately because "the mounted row must mirror
   that" (`for-each-processor.ts:67-116`). → The container expands its input at the
   start of its run and rewrites only changed elements; a missing row means pending.
8. **"Which iteration am I in" read from the container.** `for-each-index`
   (`for-each-index-processor.ts:43-44`) and `for-each-prev-outputs`
   (`for-each-prev-outputs-processor.ts:28`) read `currentIndex`, correct only
   while mounted. → The index is the last path segment.
9. **Staleness of the mounted page only.** `propagateStaleStatus` looks at child
   rows (`propagateStaleStatus.ts:163`); an ERROR in another iteration is
   invisible. → Propagation per path over every iteration.
10. **A propagation rule for the mounted input row.** Rule 3 demotes the
    `for-each-input` row of a stale container because the mounted row "sits
    GENERATED with the previous iteration's content" (`propagateStaleStatus.ts:82-87`).
    → Dropped; expansion writes input rows.
11. **A linear progress stack.** `onNodeStart` rejects a node whose parent is not
    the node on top of the stack — unchecked when the top is an iteration
    (`regenerateTreeNodesContents.ts:140-148`) — and three `finally` blocks throw
    "Stack item mismatch" (`:195-200`, `:220-225`, `:270-275`). Status events carry
    full rows, so a container's snapshot blob travels with every event.
    → A tree of frames `{nodeId, title, path}`.
12. **The panel hides a container's line by object identity**
    (`RegenerationPanel.tsx:89-90`). → Container frames are explicit.
13. **"Follow the running iteration" is a side effect** of the processor mounting
    each iteration and remounting the old page at the end
    (`for-each-processor.ts:148,170-171`). → An explicit follow-unless-pinned rule.
14. **Nested state as a string in a string.** An inner container's content sits as
    a JSON string inside the outer snapshot. → Rows at `27:2/40:0`.
15. **Megabyte debug dumps.** `getOutput` logs every snapshot on every call
    (`for-each-processor.ts:23-36`), as do `changeForEachNodePage` and
    `for-each-prev-outputs`. They go with the code they describe.
16. **Tests that know about mounting.** The fiction-arc diagnostic's LLM mock
    finds the current character through the mounted sibling row
    (`fiction-arc.diagnostic.test.ts:35-40`), and its body rebuilds the outputs
    from `overrides` with yet another variant of the rule (`:124-149`); the index
    tests set `currentIndex`. → Tests seed state by path.

## Deleted outright

**Schema.** From `plan_nodes`: the state columns `content`, `summary`,
`status`, `word_count`, `char_count`, `byte_count`, `in_review`,
`review_base_content`, `ai_improve_instruction` (they move to
`plan_node_states`; see the open question in the README), and `ai_sync_info`,
which nothing reads for plan nodes: the service creates them with null
(`plan-node-service.ts:295,314`), and the commented-out reader in
`generate-plan-node-text-content.ts:29-33` is about lore nodes. From a
`for-each`'s content: `overrides` and `currentIndex`; `{"length": n}` remains.

**Types.** `NodeOverride` and `ForEachNodeContent.overrides/currentIndex`
(`src/shared/for-each-plan-node.ts`); `ai_sync_info` on `PlanNodeRow`
(`plan-graph.ts:15,38`); stack items carrying rows (`RegenerateEvent.ts`).

**Backend.** `changeForEachNodePage`; the three repository methods above; the
`forEachNodes.changePage` route; `onChildDemoted` in the interface and in
for-each; `ForEachOutputProcessor.onUpdate`; propagation's rule 3; the parent
check and the "Stack item mismatch" throws; the mounted-row patch and per-child
seeding in `onInputContentChange`; the page restore in `ForEachProcessor.regenerate`.

**Dead code, unused today:** `generateLore` (`routes/generate-lore.ts:40`);
`asContainer` and `onNodeUpdated` on the node context (`RegenerationContext.ts:21,23`,
`regenerateTreeNodesContents.ts:236-247`) and the `nodeUpdate` event (`:27`);
`getNodeOutput` (`plan-node-service.ts:156`), `NodeUpdateEvent` (`:40`),
`PlanNodeSubscriptionEvent` (`:691`); `PlanNodeService.move` and
`reorderChildren` (`:559-594` — moves go through `patch`); `createPlanNode`
(`plan-node-routes.ts:20`); `restoreLastOpenedProject` (`db/state.ts:87`);
`src/backend/utils/backup.ts` (the live one is `db/backup.ts`);
`src/backend/db/test-utils.ts`.

**Frontend.** The `changePage` mutation and its GENERATING lock in
`ForEachPlanNodeFooter`; the identity check in `RegenerationPanel`.

**Generalised, not deleted.** Hard-coded `"for-each"` becomes "a container type":
`PLAN_CONTAINER_NODE_TYPE_VALUES` (generated from `src/schemas/plan-node-types.json:8`),
`allowedContainers` (`node-edge-dictionary.ts:114,124,134,144`), the parent checks
in `for-each-index-processor.ts:41` and `for-each-prev-outputs-processor.ts:18`,
`GroupNode.tsx:29,38`, `NodeContextMenuContent.tsx:93`,
`templates-structure.test.ts:84`, and `createForEachInternalNodes`
(`plan-node-service.ts:273-325`).

**Scripts.** `switch-foreach-iteration.ts` — mounting by hand has no meaning;
`regenerate-node --path` replaces it. The private copies of the mounted/snapshot
rule in `dump-node.ts` and `export-ready-chunks.ts` give way to one path-aware
read; `export-project-to-md.ts` reads `plan_nodes.content` in raw SQL
(`:76,137,340`) and moves to the state table.

**Tests.** `plan-node-repository.test.ts` goes with the methods it tests; the
rest of the mounting-aware tests are rewritten ([plan.md](plan.md)).

**Notes.** `plan-graph.md:35,39,108` and `graph-primitives-gaps.md:27` describe
overrides, `currentIndex` and `NodeUpdateEvent`; update them when phase 1 lands.

## Bugs that disappear with them

The editor saving the previous iteration's text after a page switch;
single-node actions landing in whichever iteration is mounted; review fields
surviving a page switch; nested loops sharing their inner rows; staleness seen
for one iteration; the phantom 25th output. Changes from outside a loop reaching
only the mounted iteration are fixed on `master` first (phase 0 #14), with the
other pre-existing bugs in [plan.md](plan.md).
