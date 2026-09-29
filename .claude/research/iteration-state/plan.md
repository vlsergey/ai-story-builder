# Iteration state — plan

*2026-09-29. Part of the architecture proposal for review; see [README.md](README.md).
Every item here was found by reading code; each is confirmed by a failing test
before it is fixed.*

## Phase 0 — bugs to fix on `master` first

These exist today and are independent of the rework. Fixing them first keeps the
rework's behaviour-preservation tests from locking wrong behaviour in.

1. `shouldRegenerate.GENERATED` follows `regenerateManual`, not
   `regenerateGenerated` (`regenerateTreeNodesContents.ts:338`, since `33b73d1`).
2. `PlanNodeService.regenerate` overwrites the processor's status by output
   truthiness (`plan-node-service.ts:495-525`): a script or format ERROR is stored
   as GENERATED, and `[]` counts as output.
3. The cascade demotes consumers whose prompt does not use the changed input, and
   MANUAL ones: `onInputContentChange` runs on the consumer as if it were already
   OUTDATED, so `text-processor.ts:42` never lets it off.
4. `DO_NOT_NOTIFY` is checked as "every key": one excluded key cancels the whole
   cascade — `aiImprove` and `startReview` change content without demoting
   anything downstream.
5. Word, char and byte counts are computed in `create` only and go stale on every
   later write; the graph shows them.
6. When the scheduler's safety counter runs out it breaks the loop and reports
   success (`regenerateTreeNodesContents.ts:350-355`).
7. An aborted node usually ends as ERROR rather than OUTDATED
   (`plan-node-service.ts:534-537`).
8. Regenerating a single node bypasses `onNodeStart`: no counters, and its own
   failure never sets `firstError` (`regenerateTreeNodesContents.ts:260-277`).
9. "Stack item mismatch" is thrown from `finally` and hides the error in flight.
10. `RegenerateStatusEvent` references the live stack array, so a queued event can
    serialise a later state.
11. `currentIndex` outlives a shortened list: `inputs[currentIndex]` is undefined
    (`for-each-processor.ts:113`).
12. The editor's "Update" button stores `startForNode`'s void result as the node
    value (`PlanNodeEditor.tsx:147-149`, since `fd8c4f4`) — found statically, to
    be reproduced first.
13. `batchPatch`, `move` and `reorderChildren` fire patches without awaiting them,
    so their cascades interleave.

**Fixed by the rework itself**, no separate change: the editor writing the old
iteration's text after a page switch; single-node actions landing in whichever
iteration is mounted; review fields surviving a page switch; nested loops sharing
their inner rows across outer iterations; staleness seen for the mounted page only.

**Dead code** to delete in passing: `generateLore`, `nodeContext.asContainer`,
`onNodeUpdated`/`nodeUpdate`, `getNodeOutput`, `NodeUpdateEvent`,
`PlanNodeSubscriptionEvent`, `utils/backup.ts`, `db/test-utils.ts`.

## Phase 1 — state model, `for-each` on it, no behaviour change

On branch `iteration-state`. In order:

1. **Tooling:** `migrateDatabase(db, {toVersion})`, the structural schema test,
   real transactions, the downgrade guard, the pinned backup, one migrating opener
   for scripts.
2. **Backend:** path helpers, `PlanNodeStateRepository`, `patchState` /
   `patchDefinition`, processors on paths, generation functions on resolved
   inputs, scoped cascade and propagation, scheduler with the path in its context
   and a tree of progress frames (concurrency 1), server-side `allowedContainers`
   and edge-shape checks, telemetry `node_id`/`path`.
3. **Migration 033**, its tests, the equivalence oracle, a dry run on copies of the
   local DBs.
4. **UI, minimum to replace mounting:** iteration selection as view state with
   follow-unless-pinned, definitions-only `findAll`, `findStatesAtPath`, editors
   bound to `(id, path)`, path-carrying events and stream buffers.
5. **Scripts** rewritten or removed.

**Tests that encode mounting** and are rewritten, keeping their intent:
`plan-node-repository.test.ts` (all), `plan-node-service.test.ts:232-269`,
`for-each-index-processor.test.ts`, `template-update.test.ts:182-258`, the
container cases of `propagateStaleStatus.test.ts` (re-seeded at `C:0`,
expectations unchanged), the fake contexts in the scheduler and fix-problems
tests, and `fiction-arc.diagnostic.test.ts:35-40,124-149` (its LLM mock finds the
current character by reading the mounted sibling row). `027.test.ts` and
`028.test.ts` read `plan_nodes.status` after running the whole chain.

**Tests that must pass unchanged** — the behaviour check: the other
template-update tests, template titles and coordinates, apply-project-template,
templates-structure, the behavioural assertions of the fiction-arc diagnostic,
computeLevelDependencies, the fix-problems and format processors,
generate-summary, telemetry, lore, backup, migrations 029/031/032, the root-only
propagation cases and the frontend tests. Plus: the sandbox story re-runs to the
same plan structure.

**Review gates:** implementation review of the backend before the UI lands; UI
review on the running app — switching iterations during a run, editing a child in
iteration 2 while iteration 0 is displayed elsewhere, a failing iteration named in
the progress panel.

## Phase 2 — `parallel-for-each`

Container processor with hash keys, dedup, growth renames and cleanup of vanished
iterations; per-node and run-wide concurrency caps, engine-aware; the dictionary
entry forbidding `for-each-prev-outputs` and `for-each-index`; progress showing
several active iterations; container display aggregate; icon, editor, i18n.
Review gates as in phase 1.

## Phase 3 — the character loop goes parallel

The fiction-arc character loop has neither `for-each-prev-outputs` nor
`for-each-index`, so its body moves as is. New projects get it from the
template. Existing ones need a type change the template updater cannot express
today; the choice between teaching it retyping and a one-off migration is left to
the architecture review.

## Size and risk

Phase 1 touches the repository, the service, every processor, five generation
functions, the scheduler, propagation, template apply/update, six scripts, the
graph, the editors, the progress panel and 13 test files. The scheduler is where
the forward-EMPTY invalidation bug lived; the cascade's scope is where correctness
now lives — mis-scoped between concurrent branches it livelocks, and the safety
counter today reports that as success (phase 0, item 6).
