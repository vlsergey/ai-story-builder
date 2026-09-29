# Iteration state — testing

*2026-09-29, revised after review; the harness and layer 1 landed on `master` in
phase 0. Part of the architecture proposal; see [README.md](README.md).*

## Principles

- **Scenarios, not internals.** A test drives the project the way a user does —
  build a graph, run it, edit, run again — and observes what the user would:
  which nodes the model was asked to write (the fake engine's call log), what
  they now say, their statuses. Tests that read `overrides`, spy on
  `PlanNodeService` or hand-build scheduler contexts pin the implementation and
  cannot prove "no behaviour change"; phase 0's own low-level tests were replaced.
- **One place knows storage.** The driver's `stateAt` and `show` are the only code
  that knows how iterations are stored. Phase 1 rewrites them; the scenarios stay.
- **Pin, don't patch, what the rework fixes.** A bug of the current storage is a
  scenario stating the right behaviour, marked `it.fails` with a line saying why.
  When the rework makes it pass, vitest reports it and it becomes `it`. Before
  trusting an `it.fails`, run it as `it` once and check it fails on its own
  assertion, not on a harness error.
- **Deterministic concurrency** (phase 2): interleavings driven by calls the test
  holds and releases, never timers.

## The harness — `src/backend/plan/scenario`

- **`fake-engine.ts`** — replaces `ai/ai-engine-adapter.js` via `vi.mock` in each
  scenario file. Default answers derive from the rendered prompts — unchanged
  inputs, same text — so a wasted re-run shows up as a call. Splits answer two
  parts that follow their input, as a real model's would; reviews find nothing.
  Handlers (`engine.on`) script answers, fail calls, or act while a call is in
  flight: edit, stop the run. Calls are logged with their kind (text, split,
  find/fix-problems, summary, improve), node, prompts and response.
- **`plan-scenario.ts`** — `PlanScenario.build` with a graph builder: `source`,
  `text`, `split`, `merge`, `format`, `fixProblems`, `loop` with `result` and
  `previousResults`, `connect`; edges into generated nodes follow the names their
  prompt text uses — matched as text, never through `templateVariables`, so the
  relevance rule under test cannot decide which edges exist. `fromTemplate`
  applies a shipped template. User actions: `run`, `regenerate`, `stop`, `type`,
  `setPrompt`, `improve`, `summarize`, `startReview`, `show`, `setRegenerate`,
  `extend`. Observations: `calls`, `generated`, `content`, `status` and
  `wordCount` (optionally per iteration), `inReview`, `loopResults`, `nodes`
  (every iteration of a loop's child), `reachableFrom`, `shownInProgress`,
  `lastStatus`.

## Layers

**1. Characterization — done.** `regeneration.test.ts` (first run, settings,
single node, failures, stop, statuses), `editing.test.ts` (what an edit re-runs
and what it spares; edits while a node is being written), `loops.test.ts` (one
result per element, sequential memory, nested loops; the storage bugs as
`it.fails`), `fiction-arc.test.ts` (the shipped template end to end).

**2. Idempotence.** A second run over a settled project asks the model nothing —
covered for plain graphs, loops and the whole template. Phase 1 keeps it for
nested and parallel loops and for a loop child added by a template update.

**3. Scope of the cascade.** Covered today: an edit re-runs exactly its readers,
spares nodes wired to it that do not read it, spares MANUAL text, and a
same-text re-run spares everything downstream; on the template, an edited style
re-runs nothing it cannot reach. Pinned for the rework: a change from outside a
loop reaching every iteration; an unchanged element staying untouched when its
list changes. Phase 1 adds: an ERROR in a side node re-runs that node only; a
move that would create a rejected edge is refused.

**4. Staleness and expansion.** Phase 1: an ERROR in an iteration nobody displays
still makes the loop need a visit; a node with nothing to generate from settles;
an inner loop fed from outside expands in a new outer iteration. Pinned: a
shorter or empty list leaves no phantom output.

**5. Late writes.** Covered today: a prompt edit, an input edit, or text typed
while a node is being written — the result is dropped, the node runs again or
keeps the user's text; an improve whose text changed meanwhile is refused.
Phase 1 moves the same scenarios onto row versions and adds: a node deleted
mid-generation stays deleted; an editor bound to a vanished iteration cannot
write.

**6. Concurrency** (phase 2), with held calls: the per-node and run-wide caps; one
iteration never demotes another's rows; a failing iteration lets its siblings
settle, then names its path; abort leaves nothing GENERATING; identical elements
make one call; two iterations stream into separate buffers; seeded stress runs
checking the invariants after each.

**7. Keys and paths** (pure): `parse`/`format` round-trip, `isAtOrBelow` a partial
order with `'27:2'` not below `'27:20'`, the SQL at-or-below predicate agreeing
with it, key growth under an injected colliding hash, `renameKey` all-or-nothing.

**8. Migration** — as in [migration.md](migration.md): synthetic fixtures for every
anomaly found in real data, the equivalence oracle, `checkStateInvariants` on
every result, a dry run on **copies** of local projects. Real project files never
enter the repository: they hold people's stories.

**9. UI** (testing-library): switching the displayed iteration issues no mutation;
an editor opened on one iteration keeps writing to it after the display moves;
a lost `rev` shows a conflict; the precedence function, table-driven.

**10. Around it:** schema drift, telemetry paths under concurrency, script smoke
tests, and the downgrade guard (done: `open-project-database.test.ts`).

## Invariants — phase 1

`checkStateInvariants(db)`, run after every engine and migration test: a node
outside loops has at most one row, at `''`; a row's path names exactly its
container ancestors; every key exists in its container's state; container rows
have the right shape and counts match the output; nothing is GENERATING outside
a run; after a successful run no child of a visited container is missing or
OUTDATED at a current key.
