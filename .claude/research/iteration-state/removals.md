# Iteration state — what goes away

*2026-09-29. Part of the architecture proposal for review; see [README.md](README.md).
Every pointer below was checked against `master` at `1eebc0e`.*

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
3. **Two sources of truth.** The mounted iteration lives in the rows, the others in
   snapshots, and the rule "rows for `currentIndex`, snapshot otherwise" is
   re-implemented in `ForEachProcessor.getOutput` (`for-each-processor.ts:38-47`),
   `dump-node.ts:179-182` and `export-ready-chunks.ts:106-122`. In local projects
   7 of 18 containers disagree with themselves. → One row per `(node, path)`.
4. **Output length is the snapshot count**, not `length`
   (`for-each-processor.ts:38`): 25 outputs for 24 elements in one project.
   → Iterate `0..length-1`.
5. **Demotions mirrored into snapshots.** `NodeProcessor.onChildDemoted`
   (`node-processor.ts:59-71`), its for-each implementation
   (`for-each-processor.ts:174-195`) and the bubbling walk that calls it
   (`demoteToOutdated`, `plan-node-service.ts:164-193`) exist so that a page
   switch does not resurrect GENERATED content. → A definition change demotes
   every path of the node in one statement.
6. **JSON surgery in SQL.** `for-each-output`'s `onUpdate`
   (`for-each-output-processor.ts:33-44`) runs a 45-line CTE
   (`updateForEachPrevOutputsStatusInsideForEachContent`,
   `plan-node-repository.ts:222-268`) that rewrites the snapshot status of
   `for-each-prev-outputs` in every iteration after `currentIndex`.
   → An ordinary dependency: prev-outputs at `C:j` reads the output at
   `C:0..j-1`, and the scoped cascade demotes it.
7. **Seeding every child to make resets work.** `onInputContentChange` writes an
   entry for every child in every iteration only so that mounting resets them,
   then patches the mounted input row separately because "the mounted row must
   mirror that" (`for-each-processor.ts:67-116`). → The container writes the
   input at `C:i`, drops the rows of changed iterations, and a missing row means
   pending.
8. **"Which iteration am I in" read from the container.** `for-each-index`
   (`for-each-index-processor.ts:43-44`) and `for-each-prev-outputs`
   (`for-each-prev-outputs-processor.ts:28`) read `currentIndex`, correct only
   while mounted. → The index is the last path segment.
9. **Staleness of the mounted page only.** `propagateStaleStatus` looks at child
   rows (`propagateStaleStatus.ts:163`); an ERROR in another iteration is
   invisible. → Propagation per path; a container's staleness covers all its
   iterations.
10. **A linear progress stack.** `onNodeStart` accepts a node only if the stack top
    is its parent (`regenerateTreeNodesContents.ts:140-148`), and three `finally`
    blocks throw "Stack item mismatch" (`:195-200`, `:220-225`, `:270-275`).
    Status events carry full rows, so a container's snapshot blob travels with
    every event. → A tree of frames `{nodeId, title, path}`.
11. **The panel hides a container's line by object identity**
    (`RegenerationPanel.tsx:89-90`). → Container frames are explicit.
12. **"Follow the running iteration" is a side effect** of the processor mounting
    each iteration and remounting the old page at the end
    (`for-each-processor.ts:148,170-171`). → An explicit follow-unless-pinned rule.
13. **Nested state as a string in a string.** An inner container's content sits as
    a JSON string inside the outer snapshot. → Rows at `27:2/40:0`.
14. **Megabyte debug dumps.** `getOutput` logs every snapshot on every call
    (`for-each-processor.ts:23-36`), as do `changeForEachNodePage` and
    `for-each-prev-outputs`. They go with the code they describe.
15. **Tests that know about mounting.** The fiction-arc diagnostic's LLM mock
    finds the current character through the mounted row or a snapshot
    (`fiction-arc.diagnostic.test.ts:124-149`); the index tests set
    `currentIndex`. → Tests seed state by path.

## Deleted outright

**Schema.** From `plan_nodes`: the state columns `content`, `summary`,
`status`, `word_count`, `char_count`, `byte_count`, `in_review`,
`review_base_content`, `ai_improve_instruction` (they move to
`plan_node_states`; see the open question in the README), and `ai_sync_info`,
which plan nodes only ever write as null (`plan-node-repository.ts:148`) and read
only in commented-out code (`generate-plan-node-text-content.ts:33`). From a
`for-each`'s content: `overrides` and `currentIndex`; `{"length": n}` remains.

**Types.** `NodeOverride` and `ForEachNodeContent.overrides/currentIndex`
(`src/shared/for-each-plan-node.ts`); `ai_sync_info` on `PlanNodeRow`
(`plan-graph.ts:15,38`); stack items carrying rows (`RegenerateEvent.ts`).

**Backend.** `changeForEachNodePage`; the three repository methods above; the
`forEachNodes.changePage` route; `onChildDemoted` in the interface and in
for-each; `ForEachOutputProcessor.onUpdate`; the parent check and the "Stack item
mismatch" throws; the mounted-row patch and per-child seeding in
`onInputContentChange`; the page restore in `ForEachProcessor.regenerate`.

**Dead code, unused today:** `generateLore` (`routes/generate-lore.ts:40`),
`RegenerationNodeContext.asContainer` (`regenerateTreeNodesContents.ts:244-247`),
`onNodeUpdated` and the `nodeUpdate` event (`:27,236-239`), `getNodeOutput`
(`plan-node-service.ts:156`), `NodeUpdateEvent` (`:40`),
`PlanNodeSubscriptionEvent` (`:691`), `src/backend/utils/backup.ts` (the live one
is `db/backup.ts`), `src/backend/db/test-utils.ts`.

**Frontend.** The `changePage` mutation and its GENERATING lock in
`ForEachPlanNodeFooter`; the identity check in `RegenerationPanel`; hard-coded
`"for-each"` in `GroupNode.tsx:38`, `NodeContextMenuContent.tsx:93` and
`PLAN_CONTAINER_NODE_TYPE_VALUES` (`plan-node-types.ts:5`) generalise to
container types.

**Scripts.** `switch-foreach-iteration.ts` — mounting by hand has no meaning;
`regenerate-node --path` replaces it. The private copies of the mounted/snapshot
rule in `dump-node.ts` and `export-ready-chunks.ts` give way to one path-aware
read; `export-project-to-md.ts` reads `plan_nodes.content` in raw SQL
(`:76,137,340`) and moves to the state table.

**Tests.** `plan-node-repository.test.ts` goes with the methods it tests; the
rest of the mounting-aware tests are rewritten ([plan.md](plan.md)).

**Notes.** `plan-graph.md:35,39` describes overrides and `currentIndex`; update it
when phase 1 lands.

## Bugs that disappear with them

The editor writing the previous iteration's text after a page switch
(`PlanNodeEditor.tsx:72-75` never re-syncs — the rework makes it adopt server
state); single-node actions landing in whichever iteration is mounted; review
fields surviving a page switch; nested loops sharing their inner rows; staleness
seen for one iteration; the phantom 25th output. Pre-existing bugs that do not
disappear on their own are phase 0 in [plan.md](plan.md).
