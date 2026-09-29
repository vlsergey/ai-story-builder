# Iteration state — writes, cascade, propagation, scheduler

*2026-09-29, revised after review. Part of the architecture proposal; see [README.md](README.md).
Storage, write ordering and processors are in [engine.md](engine.md).*

## Writes

- `patchState(id, path, manual, data, expectedRev)` — today's status rules per
  `(node, path)`, counts recomputed, then the cascade from `(X, P)`.
- `patchDefinition(id, data)` — title and layout never demote. A prompt, settings
  or input-edge change demotes the node's GENERATED, EMPTY and ERROR rows at every
  path; MANUAL rows stay, as `regenerateManual` decides for them (today a prompt
  edit demotes the mounted row even when MANUAL, and no other iteration). A
  parent change deletes the moved subtree's rows. A save carrying both applies
  the definition first.
- `create` writes the definition, plus a `''` row for a node outside loops; a loop
  child gets rows when its container expands. The internal children that
  `createForEachInternalNodes` makes for `for-each` only come for every container
  type; `openProject`'s root insert writes its `''` row.

## The cascade

From `(X, P)`: consumers in X's scope at `P`; consumers inside a loop fed from
outside at every row at or below `P`; if X's parent is a container,
`onChildStateChanged` — the output child cascades from the container at
`parentPath(P)`, and a sequential loop demotes prev-outputs at later iterations.
It never crosses into a sibling iteration. It fires only when a value consumers
read — content or summary — actually changed, and demotes only consumers that use
the input (phase 0 #3), instead of today's "any key outside `DO_NOT_NOTIFY`",
under which a status-only demotion re-expands a whole loop (phase 0 #18).

## Staleness propagation

`propagateStaleStatus` iterates over state rows to a fixpoint:

- **Forward**, per path: each source is resolved at the consumer's path (one
  outside a loop feeds every iteration); OUTDATED, ERROR, pending and a contagious
  EMPTY are stale; the relevance predicate of phase 0 #3 applies.
- **A container has two conditions.** It *needs a visit* if any child row at a
  current key is stale or pending; its *output is stale* if a row of its output
  child is. Only the second feeds the forward rule, computed from the output
  child's rows rather than the container's status. Today one ERROR in a side node
  inside a loop promotes the container, and the forward rule re-runs everything
  downstream of the loop.
- **No top-down rule.** It existed because the mounted `for-each-input` row held
  the previous iteration's content (`propagateStaleStatus.ts:82-87`); expansion
  now rewrites only changed inputs. Kept, it would demote every iteration's input
  — and so every iteration — for one stale row anywhere in the loop.
- `for-each-prev-outputs` at `P/C:j` depends on the output at `P/C:k`, `k < j`.

It writes processing state only, in batches, emitting events with paths.

## Scheduler and concurrency

- The path lives **in the regeneration context**; only the cycle context's
  `asContainers(iterations, concurrency, block)` builds child paths. It waits for
  every started iteration to settle, then rethrows the first error — otherwise the
  run's `finally` would clear `inProcess` while branches still write.
- Concurrency: a per-node cap on `parallel-for-each` (default 4) **and** a
  run-wide cap on concurrent LLM calls, engine-aware — nested caps multiply, and
  Ollama is a shared daemon (cap 1 there).
- The progress stack becomes a **tree of frames**, one per context. Events carry
  `{id, title, type}` refs and paths, not full rows, and are copied when emitted.
- `regenerateTreeNodesContents(target?: {nodeId, path})`;
  `computeLevelDependencies` runs once per container per run, not per iteration.

## Telemetry

`ai_call_stats` and the JSONL record (`telemetry.ts:211-230`) gain nullable
`node_id` and `path`, set through an AsyncLocalStorage value owned by the node
context. `iteration_index` stays the fix-problems attempt counter;
`promptCacheKeys` stays `[purpose, nodeId]` — iterations share the prefix.
`scripts/aggregate-telemetry.ts` reads the JSONL; its visit split (`:239-282`)
keys on the path, and the `wall_time ≥ sum(durations)` invariant documented in
`telemetry-aggregation.md:15` no longer holds for parallel runs.
