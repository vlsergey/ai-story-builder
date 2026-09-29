# Iteration state — rework proposal

*2026-09-29. Status: phase 0 done on `master`; **phase 1 landed** on branch
`iteration-state` ([plan.md](plan.md)), its implementation review under way;
phases 2–3 next. Re-verify pointers before relying on them.*

## In short

A `for-each`'s iterations share one set of child rows; the other iterations sit as
JSON snapshots inside the container and are copied in and out ("mounting"). That
makes loops sequential by construction and breeds the hacks listed in
[removals.md](removals.md). The proposal:

- **Definitions and state in separate tables.** `plan_nodes` keeps what a node
  *is*; `plan_node_states` keeps what it *produced*, keyed by
  `(node_id, path)`, where the path names every enclosing container and iteration:
  `''`, `'27:2'`, `'27:2/40:0'`.
- **Containers store no child state.** A `for-each` keeps `{"length": n}`.
- **What the UI shows is not what processors process.** The selected iteration
  is client view state; switching it writes nothing.
- **A new `parallel-for-each`** runs iterations concurrently, keyed by a content
  hash; identical elements run once.
- **Nesting works**, because paths nest.

## Reading order

| note | what it covers |
|---|---|
| [current-model.md](current-model.md) | how mounting worked before phase 1 — what migration 033 reads |
| [removals.md](removals.md) | every hack that goes, and what replaces it |
| [data-model.md](data-model.md) | the state table, the path, missing vs EMPTY, iteration identity |
| [engine.md](engine.md) | paths, repository, write ordering, processors, input resolution |
| [cascade.md](cascade.md) | writes, the cascade, staleness propagation, scheduler, telemetry |
| [ui.md](ui.md) | view state vs processing state, fetching, events, editors, progress |
| [migration.md](migration.md) | migration 033, backups, downgrade guard, templates and scripts |
| [testing.md](testing.md) | test infrastructure and layers, in order of value |
| [plan.md](plan.md) | phase 0 results, phases 1–3, review gates, size and risk |

## Decisions already taken

By the project owner, 2026-09-29:

1. Definition and state live in different tables; definitions are read as today,
   state through the enclosing container.
2. Display state and processing state are different things.
3. Nesting is allowed.
4. The state key includes a hierarchical path of container and iteration ids.
5. Containers stop storing their children's state.
6. `for-each` identifies an iteration by its index; `parallel-for-each` by a hash
   whose length grows when it stops being unique.
7. Identical elements of a parallel container are processed once.
8. A parallel container allows fewer child types than `for-each`
   (no `for-each-prev-outputs`, no `for-each-index`).
9. The rework gets a mandatory post-review of architecture, implementation and UI.
10. Tests are scenarios, not internals. A bug that only the new storage fixes is
    not fixed on `master`: a scenario pins it with `it.fails`.

## Proposed here, open to review

- A missing row means *pending*, an EMPTY row *produced nothing*, and every node
  type resolves pending — a node with nothing to generate from writes a settled row.
- Rows carry a version; results computed over minutes land only if the row has not
  changed meanwhile, and nothing is written under a vanished iteration.
- A container expands its input at the start of its own run; renames and cleanup
  happen only then.
- Propagation separates "the container needs a visit" from "its output is stale",
  and drops the top-down rule, so one stale row does not re-run a whole loop.
- A cascade fires only when content or summary actually changed, and only into
  consumers that use the input.
- A prompt edit leaves MANUAL rows alone.
- Generation functions take resolved inputs; edges from inside a loop to outside
  it, or across sibling loops, are rejected, reparenting included.
- Phase 0 — done: the pre-existing bugs fixed on `master`, the storage-bound
  ones pinned by scenarios, one dropped as invisible; nine more found by the
  scenarios and a review, all fixed.

## Open questions

1. ~~`ai_improve_instruction`: state or definition?~~ State, per iteration
   (decided; 033 moves it with the rest).
2. Phase 3: teach the template updater to change a node's type, or move existing
   projects' character loops with a one-off migration?
3. Is 6 hex characters the right minimum key length?
4. Add `fast-check` as a dev dependency for property tests?
5. ~~Concurrency defaults~~ Decided: a setting of the engine — Ollama 1,
   Yandex and Grok 10; a parallel container may override it lower. The
   container type is called `parallel`.
6. ~~A prompt edit on a MANUAL node~~ Decided: it stays MANUAL.
7. Text typed into a prompt-less node inside a loop exists at one path. Offer
   "apply to every iteration", or treat such text as part of the definition?
8. The migration clears review state on loop children, since it may belong to
   another iteration. Acceptable, or keep it at the mounted page with a warning?

## Review log

- **2026-09-29, fact-check** against `master`: about 115 claims checked; four were
  false (one hid phase 0 #14), nine imprecise; items missing from removals.md
  added. All corrected.
- **2026-09-29, design critique**: one blocker (late writes overwrite newer state
  → row versions), four major (over-demotion through the top-down rule, pending
  rows with no producer, inner loops never re-expanded, migration gaps), four
  minor. All folded in.
- **2026-09-29, phase 0** on `master`, `df38f40`…`0bbdaf9`. The owner set the
  rule: scenario tests only, and storage-bound bugs pinned with `it.fails`
  rather than fixed. The scenario harness found two more bugs, both fixed.
- **2026-09-29, review of phase 0**: two regressions of its fixes, four more
  gaps, blind spots in the harness and a template bug (the first chunk always
  got continuation instructions). All fixed test-first: `ef8d517`,
  `a20348b`, `7705e15`.
