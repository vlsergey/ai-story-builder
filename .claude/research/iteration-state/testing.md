# Iteration state — testing

*2026-09-29, revised after review. Part of the architecture proposal; see [README.md](README.md).*

## Principles

- **Test behaviour, not storage.** Today's loop tests read `overrides` directly,
  so they pin the implementation and cannot prove "no behaviour change". The
  observable of a run is: the outputs, the statuses, and **which calls reached the
  model** — the call log of a deterministic fake adapter.
- **Characterize through a driver.** Scenarios talk to a thin driver —
  `edit(node, iteration, fields)`, `run()`, `outputs()`, `calls()` — implemented
  once over mounting (`changePage` + `patch`) and once over paths (`patchState`).
  Only the driver changes in phase 1; an edit in iteration 2 is the action under
  test, not fixture setup, so it cannot hide in the fixtures.
- **Encode fixed behaviour, never a known bug.** Characterization is written after
  the phase 0 fixes. A scenario that stays broken on `master` — nested loops, a
  vanished iteration — is an expected failure (`it.fails`) that phase 1 must flip.
- **Check invariants after every test.** A cheap structural checker catches whole
  classes of bugs — orphan rows, wrong paths — that scenarios catch only by luck.
- **Make concurrency deterministic.** Interleavings are driven by promises the test
  resolves by hand, not by timers.

## Infrastructure

1. **`FakeAdapter`** — content derived from its inputs (a short hash of the
   rendered prompt), so outputs are checkable and a re-run yields the same text;
   records every call `{nodeId, path, purpose, prompt}`; manual gates to hold a
   call in flight; can fail a chosen call. Replaces the ad hoc mocks
   (`generate-summary.test.ts`, the fiction-arc diagnostic's LLM mock).
2. **Graph builder** — a small DSL for containers, children and edges, so a
   scenario reads as a graph rather than as thirty `insert` calls.
3. **The driver** above.
4. **`checkStateInvariants(db)`** (phase 1):
   - a node outside loops has at most one row, at `''`;
   - a row's path has one segment per container ancestor, naming exactly those
     ancestors in order;
   - every segment's key exists in its container's own state, so no row sits
     under a vanished iteration;
   - container rows have the right content shape; counts match the output;
   - nothing is GENERATING when no run is active;
   - after a successful run, no child of a visited container is missing or
     OUTDATED at a current key.
5. **`migrateDatabase(db, { toVersion })`** (phase 1), so migration tests build a
   v32 DB by running the chain.
6. **Property testing:** `fast-check` as a dev dependency for the path algebra, key
   allocation and migration shapes — or seeded hand-written generators.

## Layers, most valuable first

**1. Characterization** (phase 0, after its fixes). For `for-each`: outputs after
a full run; what re-runs when a root input, one element, one child's prompt or one
child's content changes — including a source outside the loop, which must reach
every iteration (phase 0 #14); prev-outputs and index values per iteration; the
fiction-arc graph end to end. Assert on the call log.

**2. Idempotence.** A second run over a settled graph makes **zero** model calls —
the regression test for the invalidation-bug class of `accfede` — across every
scenario, including a prompt-less node inside a loop and a loop child just added
by a template update. A deterministic node that reproduces its content causes no
downstream call.

**3. Scope of the cascade** — where correctness now lives. Change a child in
iteration 2 of a sequential loop: iteration 2's downstream and later iterations'
prev-outputs re-run, iterations 0–1 do not. In a parallel loop: only iteration 2.
A source outside the loop demotes every iteration's consumer; a prompt change
every non-MANUAL row. An ERROR in a side node re-runs that node only — no other
iteration, nothing downstream of the loop — while a stale output re-runs the
loop's consumers. Nested loops: outer element 1 touches only `27:1/…`. A move
deletes the node's rows; a move that would create a rejected edge is refused.

**4. Staleness and expansion.** An ERROR in an iteration nobody displays still
makes the container need a visit (today it does not). A new iteration with no
rows is pending. A deterministic node's EMPTY with settled inputs is not
contagious, nor is the EMPTY of a node with nothing to generate from; a generative
node's is. A shrunk input deletes vanished iterations and the output has `length`
entries. An outer loop grows: an inner loop fed from outside it expands in the new
iteration and produces its full output.

**5. Late writes** (phase 1 — editing during a run is one of its review gates):
a prompt edit while its node generates drops the result and the node re-runs;
improve during a run loses to the generation, or the generation to improve —
never silently; a node deleted mid-generation stays deleted; an editor saving
after a generation finished gets a conflict; an editor bound to a vanished path
cannot write.

**6. Concurrency** (phase 2), with gated fake calls:
- in-flight calls never exceed the per-node cap, nor the run-wide cap across two
  nested parallel containers;
- iteration A's writes never demote iteration B's finished rows;
- one failing iteration: its siblings settle first, then the error surfaces and
  names its path; `inProcess` stays set until every branch has settled;
- abort mid-run: nothing left GENERATING, in-flight nodes end OUTDATED;
- identical elements make one call and fill both positions;
- two iterations of one node stream into separate buffers; progress shows two
  active entries;
- **seeded stress**: many random interleavings with a fixed seed list; after each,
  every node settled, invariants hold, the safety counter was never reached.

**7. Keys and paths** (pure, property-based): `parse`/`format` round-trip;
`childPath`/`parentPath` inverse; `isAtOrBelow` is a partial order and
`'27:2'` is not below `'27:20'`; **the SQL at-or-below predicate agrees with
`isAtOrBelow`** on a generated corpus. Key allocation: at least 6 characters,
unique among distinct elements, grows under an injected colliding hash, never
shrinks, unchanged elements keep their key; after growth the full hash decides
which element owned old rows; `renameKey` moves nested rows and rolls back whole.

**8. Migration** — as in [migration.md](migration.md): named synthetic fixtures
for every anomaly found in real data, the equivalence oracle, a property test
over random container shapes, `checkStateInvariants` on every result, a dry run
on **copies** of local projects. Real project files never enter the repository:
they hold people's stories.

**9. UI** (testing-library): switching the displayed iteration issues **no**
mutation and works while the container is GENERATING; follow-unless-pinned;
selection survives an upstream insertion; an editor opened at `27:2` keeps
writing to `27:2` after the display moves to `27:0` — the data-loss regression of
today; a lost `rev` shows a conflict; a state event for `27:2` invalidates only
that path's queries; the precedence function, table-driven, with EMPTY-as-final
and missing rows. Then the review on the running app.

**10. Around it:** schema drift (chain-built DB against `schema.sql`); telemetry
records `node_id` and `path`, and two concurrent calls record their own paths —
AsyncLocalStorage leaking across branches is the classic failure; smoke tests for
the rewritten scripts on a migrated fixture; the downgrade guard, in its phase 0
release, refuses a newer file.

## When

Fake adapter, graph builder, driver and layer 1 land on `master` in phase 0, after
its fixes. `checkStateInvariants` and `migrateDatabase({toVersion})` come with
phase 1 step 1 — path rows do not exist before it — and layers 2–5 and 7–10 grow
with phase 1. Layer 6 is phase 2's entry ticket.
