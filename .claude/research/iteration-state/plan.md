# Iteration state — plan

*2026-09-29, revised after review. Part of the architecture proposal; see [README.md](README.md).
Every item here was found by reading code; each is confirmed by a failing test
before it is fixed.*

## Phase 0 — bugs to fix on `master` first

These exist today and are independent of the rework. Fixing them first keeps the
rework's behaviour-preservation tests from locking wrong behaviour in.

1. `shouldRegenerate.GENERATED` follows `regenerateManual`, not
   `regenerateGenerated` (`regenerateTreeNodesContents.ts:338`, since `33b73d1`).
2. `PlanNodeService.regenerate` overwrites the processor's status by output
   truthiness (`plan-node-service.ts:495-525`): a script or format ERROR is stored
   as GENERATED, and `[]` counts as output — `for-each-prev-outputs` is GENERATED
   on iteration 0.
3. The cascade demotes consumers whose prompt does not use the changed input, and
   MANUAL ones: it marks the consumer OUTDATED before asking its processor, whose
   "no change" answer (`return null`) cannot undo that, so the text processor's
   own check (`text-processor.ts:42`) never fires (`plan-node-service.ts:207-229`).
   Propagation's forward rule is just as structural (`propagateStaleStatus.ts:157-161`);
   the fix gives both one relevance predicate. **Seen live**: in the 2026-09-29
   sandbox run the cascade demoted parked MANUAL nodes below the plan and the
   scheduler ran into them.
4. `DO_NOT_NOTIFY` is checked as "every key": one excluded key cancels the whole
   cascade — `aiImprove` and `startReview` change content without demoting
   anything downstream.
5. Word, char and byte counts are computed in `create` only, from raw content, and
   go stale on every later write; the graph shows them.
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
13. `batchPatch` fires its patches without awaiting them (`router.ts:112-118`): the
    mutation resolves before the writes land and a failure is an unhandled
    rejection. Its only caller sends layout keys, which never cascade.
14. **A change from outside a loop reaches the mounted iteration only.** The
    cascade (`plan-node-service.ts:201-232`) and a prompt edit (`:416-418`) demote
    the mounted row; only template updates mirror into snapshots. Each
    fiction-arc template has 25 edges entering a loop — edit Style or World, and
    the other characters keep their old profiles. Fix: mirror into every snapshot
    when the change comes from outside the loop or from the definition, writing
    snapshots through the repository — `patch` marks the container GENERATED
    (`for-each-processor.ts:193`).
15. fix-problems labels its fix stream with the next attempt's index: `iteration++`
    (`fix-problems-processor.ts:90`) runs before the fix callback reads it (`:106`).
16. A result lands on a row that changed while it was computed: `regenerate`
    writes without looking (`plan-node-service.ts:467-533`), so a prompt edit
    during generation is lost; `aiImprove` writes MANUAL over whatever the row
    holds by then (`:662-681`). Fix on `master`: land the result only if the row
    is still GENERATING; phase 1 turns this into a row version.
17. An older build opens a newer database silently: the migration loop skips
    `fromVersion > CURRENT_VERSION` (`migrations.ts:152`). The guard must ship in a
    release **before** 033 — the build users roll back to is the one that refuses.
18. A notification with no content change resets every iteration of a loop: the
    cascade fires on a status-only patch, and `onInputContentChange` marks every
    iteration's input OUTDATED whether its element changed or not
    (`for-each-processor.ts:81-90`); each input then re-runs and cascades through
    its iteration. The 2026-09-29 log shows the chunk loop rebuilding its
    snapshots after a status-only demotion of its input.

**Fixed by the rework itself**, no separate change: the editor saving the old
iteration's text after a page switch; single-node actions landing in whichever
iteration is mounted; review fields surviving a page switch; nested loops sharing
their inner rows; staleness seen for the mounted page only; the phantom output.
Dead code and the rest of what goes: [removals.md](removals.md).

## Phase 1 — state model, `for-each` on it, no behaviour change

On branch `iteration-state`. In order:

1. **Tooling:** `migrateDatabase(db, {toVersion})` with `migrateDatabase(db, true)`
   still working, the structural schema test, real transactions, the pinned
   backup, one migrating opener for scripts; `schema.sql` regenerated before step
   2's tests need it.
2. **Backend:** path helpers, `PlanNodeStateRepository` with row versions and
   compare-and-set writes, `patchState` / `patchDefinition`, processors on paths,
   container expansion at the start of a run with cleanup of vanished iterations,
   the five generation functions on resolved inputs, scoped cascade and
   propagation, scheduler with the path in its context and a tree of progress
   frames (concurrency 1), server-side `allowedContainers` and edge-shape checks,
   telemetry `node_id`/`path`.
3. **Migration 033**, its tests, the equivalence oracle, a dry run on copies of the
   local DBs. Needs the `ai_improve_instruction` decision: 033 drops the column.
4. **UI, minimum to replace mounting:** iteration selection as view state with
   follow-unless-pinned, definitions-only `findAll`, `findStatesAtPath`, editors
   bound to `(id, path)` with conflict handling, path-carrying events and stream
   buffers.
5. **Scripts** rewritten or removed.

**Tests that encode mounting** and are rewritten, keeping their intent:
`plan-node-repository.test.ts` (all), `plan-node-service.test.ts:232-269`,
`for-each-index-processor.test.ts`, `template-update.test.ts:182-258`, the
container cases of `propagateStaleStatus.test.ts` (re-seeded at `C:0`),
`fiction-arc.diagnostic.test.ts:27-58,124-149`, `PlanTextNode.test.tsx` (state
moves out of node data). Tests that seed or read state through
`PlanNodeRepository` — `templates-structure.test.ts:650-668`,
`template-update.test.ts:107-124,171-177,350-361` — move to the state table;
**the templates-structure check would otherwise pass silently** once `findAll`
returns definitions, so its rewrite must be shown to fail first. `027.test.ts` and
`028.test.ts` read `plan_nodes.status` after running the whole chain. The fake
contexts in the scheduler and fix-problems tests change; their assertions stay.

**Tests that must pass unchanged** — the behaviour check: the other
template-update tests, template titles and coordinates, apply-project-template,
the behavioural assertions of the fiction-arc diagnostic,
computeLevelDependencies, the format processor, generate-summary, telemetry, lore,
backup, migrations 029/031/032, the root-only propagation cases, the other
frontend tests, and the characterization suite ([testing.md](testing.md)). Plus:
the sandbox story re-runs to the same plan structure.

**Review gates:** implementation review of the backend before the UI lands; UI
review on the running app — switching iterations during a run, editing a child in
iteration 2 while iteration 0 is displayed elsewhere, editing a prompt while its
node generates, a failing iteration named in the progress panel.

## Phase 2 — `parallel-for-each`

Container processor with hash keys, dedup and growth renames; per-node and
run-wide concurrency caps, engine-aware; the dictionary entry forbidding
`for-each-prev-outputs` and `for-each-index`; progress showing several active
iterations; container display aggregate; icon, editor, i18n. Review gates as in
phase 1.

## Phase 3 — the character loop goes parallel

The fiction-arc character loop has neither `for-each-prev-outputs` nor
`for-each-index`, so its body moves as is. New projects get it from the
template. Existing ones need a type change the template updater cannot express
today; the choice between teaching it retyping and a one-off migration is left to
the architecture review.

## Size and risk

Phase 1 touches the repository, the service, every processor, five generation
functions, the scheduler, propagation, template apply/update, seven scripts
(six readers of `plan_nodes` state and `aggregate-telemetry`), the graph, the
editors, the progress panel and 15 test files. The scheduler is where the
forward-EMPTY invalidation bug lived; the cascade's scope is where correctness now
lives — mis-scoped between concurrent branches it livelocks, and the safety
counter today reports that as success (phase 0, item 6).
