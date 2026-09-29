# Iteration state — testing

*2026-09-29. Part of the architecture proposal for review; see [README.md](README.md).*

## Principles

- **Test behaviour, not storage.** Today's loop tests read `overrides` directly,
  so they pin the implementation and cannot prove "no behaviour change". The
  observable of a run is: the outputs, the statuses, and **which calls reached the
  model** — the call log of a deterministic fake adapter.
- **Pin behaviour on `master` before changing storage.** Characterization tests
  written against the current code, through the public surface only, then run
  unchanged against the new one. Only their fixture setup may differ.
- **Check invariants after every test.** A cheap structural checker, run by every
  engine and migration test, catches whole classes of bugs — orphan rows, wrong
  paths — that scenario tests only catch by luck.
- **Make concurrency deterministic.** Interleavings are driven by promises the test
  resolves by hand, not by timers.

## Infrastructure to build first

1. **`FakeAdapter`** — returns content derived from its inputs (e.g. a short hash
   of the rendered prompt), so outputs are checkable and a re-run yields the same
   text; records every call `{nodeId, path, purpose, prompt}`; optional manual
   gates to hold a call in flight; can fail a chosen call. Replaces the ad hoc
   mocks (`generate-summary.test.ts`, the fiction-arc diagnostic's LLM mock).
2. **Graph builder** — a small DSL for containers, children and edges, so a
   scenario reads as a graph rather than as thirty `insert` calls.
3. **`checkStateInvariants(db)`**:
   - a node outside loops has at most one row, at `''`;
   - a row's path has one segment per container ancestor, naming exactly those
     ancestors in order;
   - every segment's key exists in its container's own state (`index < length`;
     parallel key in `iterations`), so no row sits under a vanished iteration;
   - container rows have the right content shape; counts match content;
   - nothing is GENERATING when no run is active.
4. **`migrateDatabase(db, { toVersion })`**, so migration tests build a v32 DB by
   running the chain.
5. **Property testing:** add `fast-check` as a dev dependency — for the path
   algebra, key allocation and migration shapes, a generator finds the case nobody
   thought of. If the dependency is unwelcome, seeded hand-written generators.

## Layers, most valuable first

**1. Characterization on `master`** (phase 0). With the fake adapter, for
`for-each`: outputs after a full run; what re-runs when a root input, one element,
one child's prompt or one child's content changes; prev-outputs and index values
per iteration; the fiction-arc graph end to end. Assert on the call log. Then the
same tests pass after phase 1.

**2. Idempotence.** A second run over a settled graph makes **zero** model calls —
the regression test for the invalidation-bug class of `accfede`, across every
scenario below.

**3. Scope of the cascade** — where correctness now lives. Change a child in
iteration 2 of a sequential loop: iteration 2's downstream and later iterations'
prev-outputs re-run, iterations 0–1 do not. The same in a parallel loop: only
iteration 2. A root source change demotes every iteration's consumer. Nested
loops: changing outer element 1 touches only `27:1/…`. A prompt change demotes
every path. A move deletes the node's rows.

**4. Staleness.** An ERROR in an iteration nobody displays still makes the
container stale (today it does not). A new iteration with no rows makes it stale.
A deterministic node's EMPTY row with settled inputs is not contagious; a
generative node's is. A shrunk input deletes vanished iterations and the output
has `length` entries.

**5. Concurrency** (phase 2), with gated fake calls:
- in-flight calls never exceed the per-node cap, nor the run-wide cap across two
  nested parallel containers;
- iteration A's GENERATING patch never demotes iteration B's finished rows;
- one failing iteration: its siblings settle first, then the error surfaces and
  names its path; `inProcess` stays set until every branch has settled, and a
  second run cannot start in between;
- abort mid-run: nothing left GENERATING, in-flight nodes end OUTDATED;
- identical elements make one call and fill both positions;
- two iterations of one node stream into separate buffers; progress shows two
  active entries and never throws "stack item mismatch";
- **seeded stress**: many random interleavings with a fixed seed list; after each,
  every node settled, invariants hold, the safety counter was never reached.

**6. Keys and paths** (pure, property-based): `parse`/`format` round-trip;
`childPath`/`parentPath` inverse; `isAtOrBelow` is a partial order and
`'27:2'` is not below `'27:20'`; **the SQL at-or-below predicate agrees with
`isAtOrBelow`** on a generated corpus. Key allocation: at least 6 characters,
unique among distinct elements, grows under an injected colliding hash, never
shrinks, unchanged elements keep their key when others come and go; after growth
the full hash, not the short key, decides which element owned old rows;
`renameKey` moves nested rows and rolls back whole if it fails midway.

**7. Migration** — as in [migration.md](migration.md): fixtures, the equivalence
oracle against a frozen copy of the old read logic, a property test over random
container shapes (`length` against snapshot count, null slots, missing status,
`currentIndex` out of range), `checkStateInvariants` on the result, and a dry run
on **copies** of local projects. The anomalies found in real data — rows
disagreeing with the snapshot, a snapshot beyond `length` — become named
*synthetic* fixtures. Real project files never enter the repository: they hold
people's stories.

**8. UI** (testing-library): switching the displayed iteration issues **no**
mutation and works while the container is GENERATING; follow-unless-pinned; an
editor opened at `27:2` keeps writing to `27:2` after the display moves to `27:0`
— the data-loss regression of today; the editor adopts server state when clean and
locks content while its path is GENERATING; a state event for `27:2` invalidates
only that path's queries; the display precedence function, table-driven, with
EMPTY-as-final and missing rows. Then the review on the running app.

**9. Around it:** schema drift (chain-built DB against `schema.sql`); telemetry
records `node_id` and `path`, and two concurrent calls record their own paths —
AsyncLocalStorage leaking across branches is the classic failure; smoke tests for
the rewritten scripts on a migrated fixture; the downgrade guard refuses a newer
file.

## When

Infrastructure and layer 1 land on `master` in phase 0, before any storage change.
Layers 2–4, 6–9 grow with phase 1. Layer 5 is phase 2's entry ticket.
