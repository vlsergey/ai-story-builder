# Iteration state — plan

*2026-09-29, revised after review; phase 0 done the same day. Part of the
architecture proposal; see [README.md](README.md).*

## Phase 0 — done on `master`

The rule, set by the project owner: a bug that only the new storage fixes is not
fixed on `master` — a scenario test pins it with `it.fails`, and phase 1 must
flip it. Everything else was fixed test-first. Tests are scenarios
([testing.md](testing.md)).

| # | bug | outcome |
|---|---|---|
| 1 | `shouldRegenerate.GENERATED` followed `regenerateManual` | fixed `df38f40` |
| 2 | status came from output truthiness: a template ERROR stored as GENERATED | fixed `55825fe`; an empty list stays an answer, `a20348b` |
| 3 | the cascade demoted MANUAL consumers and ones whose prompt ignores the input; the text processor looked for `{{T}}` where templates write `{{[T]}}` | fixed `df8c4ce`: one relevance rule from the Handlebars AST, shared with propagation |
| 4 | the cascade fired on keys, not changes: `in_review` cancelled it, starting to generate demoted every reader | fixed `df8c4ce` |
| 5 | counts computed in `create` only, from raw JSON | fixed `c27ffef` |
| 6 | an exhausted safety counter reported success | fixed `df38f40` |
| 7 | an aborted node ended ERROR | fixed `55825fe` |
| 8, 12 | a single node bypassed `onNodeStart`; `startForNode` returned nothing, which the editor stored as the node | fixed `df38f40` |
| 9, 10 | "Stack item mismatch" hid the real error; status events shared the live stack | fixed `df38f40` |
| 11 | a shorter or empty list leaves a phantom output | pinned `8741c24` |
| 13 | `batchPatch` did not await its patches | fixed `43aadc7` |
| 14 | a change from outside a loop, or a prompt edit, reaches the mounted iteration only | pinned `8741c24`, also on the fiction-arc template |
| 15 | fix-problems labels its fix stream with the next attempt | dropped: the UI only resets its buffer on a new label, nothing visible |
| 16 | a result landed over a row changed meanwhile | fixed `55825fe`; the node runs again in the same run, `8741c24` |
| 17 | an older build opened a newer database silently | fixed `0bbdaf9`, ships before 033 |
| 18 | an unchanged element is re-run and re-summarized when its list changes | pinned `8741c24` |
| 19 | *found by a scenario*: with «regenerate manual» on, a typed synopsis counted as stale and dragged everything below it through the model | fixed `8741c24` |
| 20 | *found by a scenario*: a node whose result was dropped stayed OUTDATED when nothing read it | fixed `8741c24` |
| 21 | *found by review*, a regression of #4: a sequential loop no longer refreshed later iterations after an earlier result changed | fixed `a20348b`: prev-outputs copies what it reads into its content |
| 22 | *found by review*, a regression of #2: a split's legitimate `[]` became EMPTY, retried and demoting downstream on every run | fixed `a20348b` |
| 23 | *found by review*: the safety counter failed valid runs deferred in a bad order | fixed `a20348b`: only re-runs count; a pass with nobody ready is a cycle |
| 24 | *found by review*: a summary-only write demoted every reader | fixed `a20348b` |
| 25 | *found by review*: loop elements outside the display showed 0 words | fixed `a20348b` |
| 26 | *found by review*: refused opens rotated out the readable backups; creating a project over an existing file skipped the guard and the migrations | fixed `7705e15` |
| 27 | *found by review*: fiction-arc branched on «Номер чанка» without its edge, so the first chunk got the continuation instructions | fixed `ef8d517`, both languages; the structural test now reads references through the AST |

Also pinned in `src/backend/plan/scenario/loops.test.ts`: a review crossing
iterations, a nested loop showing another part's scenes. The rest of what goes
with mounting: [removals.md](removals.md).

## Phase 1 — state model, `for-each` on it, no behaviour change

**Landed** on `iteration-state`: `f9ac300`, `7d38671`. The scenario suite passes
with only its driver changed; all eight `it.fails` flipped. 033 dry run on copies
of the nine local projects: 1164/1164 loop-child iterations read as the old model
read them; one WARN (the known 25th snapshot of «Брат и сёстры»).
Where the code went beyond or differs from the plan below:

- A loop writes a changed element's input as OUTDATED; the iteration's own run
  settles it, so it is counted and summarized like any node (the scenario
  "does not summarize unchanged elements" needs exactly that).
- A prompt edit also demotes GENERATING rows, so the in-flight result is dropped.
- Adding, removing or retyping an edge demotes the target everywhere if its
  prompt reads the source.
- Every external write names a current iteration (`checkPath`, 404 otherwise).
  Editor saves of state fields are compare-and-set; on a 409 the editor saves on
  top when only statuses moved, and asks when the text changed.
- Telemetry `node_id`/`path` come from an AsyncLocalStorage set per node run
  (migration 034). The progress event names the first failure (`firstErrorAt`).
- **Deferred:** the tree of progress frames (only concurrency needs it — phase 2),
  `iterationStatuses` and path-carrying node events (the UI still invalidates
  every node query on any event), a missing row shown as EMPTY in the graph.

The plan as written:

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

**The behaviour check is the scenario suite** in `src/backend/plan/scenario`:
it passes unchanged except for its driver — `stateAt` and `show` in
`plan-scenario.ts` are the only code that knows how iterations are stored — and
every `it.fails` there becomes `it`. Plus: the sandbox story re-runs to the same
plan structure.

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
The rest — template, migration, lore, telemetry and frontend tests — passes
unchanged.

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
counter now fails such a run instead of reporting success.
