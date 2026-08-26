# Graph primitives — gaps and deferred work

> Last verified: 2026-05-13. Re-check before relying on file paths and line numbers.

Gaps in the node/edge primitive set that surfaced while designing the fiction generation pipeline (see [`fiction-arc-pipeline.md`](fiction-arc-pipeline.md)). Listed in order of impact, with the status of each.

## Done

### LLM-driven split (commit `fbdbe20`)

The `split` node now does an LLM call returning `{parts: string[]}` with retry-on-invalid-JSON. The "how to split" prompt lives in `node_type_settings.userPrompt` (post commit `a9aaed8`). Implementation in [`src/backend/plan/nodes/graph/split-processor.ts`](../../src/backend/plan/nodes/graph/split-processor.ts) + helper [`src/backend/ai/generate-split-parts.ts`](../../src/backend/ai/generate-split-parts.ts). Migration 027 ([`src/backend/db/migrations/027.ts`](../../src/backend/db/migrations/027.ts)) translates legacy regex configs to natural-language prompts.

### Prompts moved off `plan_nodes` row into `node_type_settings` (commit `a9aaed8`)

`ai_user_prompt` / `ai_system_prompt` dropped as columns. For `text` / `split` / `lore` types they live in `node_type_settings.userPrompt` / `.systemPrompt`. Migration 028 ([`src/backend/db/migrations/028.ts`](../../src/backend/db/migrations/028.ts)) does the data move; non-LLM types (merge, for-each*) warn-and-drop on stale prompt values. `ai_settings` stays at the row level (engine-determined, not node-type-determined).

### `partDescription` on `split` nodes (commit `94794eb`)

`SplitSettings.partDescription?: string` injected into the response schema as `items.description`. Lets the template author describe one array element ("one plot beat, 80–100 words, prose, no headers") without duplicating it in the user prompt — keeps the creative pass and the contract pass separate, in the spirit of [[project-json-schema-dumbs-models]].

### Cross-parent edges in templates (commit `7ba71c8`)

Apply now uses sibling-first then a flat global-title map to resolve `sourceNodeTitle`. Export drops the cross-parent throw and validates global plan-title uniqueness instead. for-each-input / for-each-output are exempt from global uniqueness (their fixed "Input"/"Output" titles repeat across containers). This unblocked the fiction-arc template — `Style`, `Cast bible`, `Plot outline split` and friends are now visible from inside the scene for-each loops.

### `for-each-index` node type (commit `4de6157`)

User-placed leaf node inside a for-each that emits the current 1-based iteration position as text via `getOutput`. No override storage, no regeneration — pure function of the parent for-each's `currentIndex`. Used in fiction-arc so each scene's prose starts with `## Часть {{Номер сцены}}` — the second-draft pass then re-locates each scene in the merged first draft by header without re-splitting.

### Forward propagation of EMPTY (commit `accfede`)

`EMPTY` says "has no content" and nothing more, but `propagateStaleStatus` read
it forward as "work pending". One `merge` aggregating previous iterations is
legitimately EMPTY on iteration 0; it fed six siblings, they were pre-marked
OUTDATED, that promoted the for-each container bottom-up, and re-rendering a
single downstream `format` node re-ran ~55 min of prose. Bottom-up propagation
had already carved out this exact node; the forward rule had not.

Fix in [`propagateStaleStatus.ts`](../../src/backend/plan/nodes/generate/propagateStaleStatus.ts):
`computeContagiousEmpty` splits the two meanings. A deterministic node (`merge`,
`script`, `format`, the `for-each-*` internals) fed by settled inputs re-runs to
the same emptiness, so its EMPTY is an answer and readers stay fresh. A
generative node's emptiness stays contagious, as does a deterministic node's
while anything upstream of it is still pending. Measured on the graph that
caused it: 11 nodes pre-marked → 0, 55 min → 0.4 s.

Note for future digging: per-iteration state is **not** the gap here.
`NodeOverride` already carries `status` per iteration, saved and restored by
`collectForEachNodeIterationContentFromChildren` /
`applyForEachNodeIterationToChildren`. The row status of a for-each child is
simply the mounted iteration's, which is correct — the bug was entirely in what
got inferred from it.

## Open — deferred but planned

### `llm-boundary-split` — for splitting large existing inputs

The current `llm-split` (post-refactor) asks the LLM to **emit each chunk verbatim** in the JSON output. That breaks for inputs that exceed the LLM's output cap (~1500 words on Grok). E.g. a user pasting a 15kb existing draft and asking the system to split it into scenes — the output array alone exceeds the cap.

Solution: a separate node type that asks the LLM only for **boundary markers** (line indices, or "the line that starts each piece"), then the runtime does the cutting against the original input. Output stays small (20 anchors × 20 words = 400 words), input fidelity is exact.

Status: **not blocking** for the fiction-arc pipeline — second-draft pass uses `## Часть {{Index}}` header navigation, not re-splitting. Deferred until a workflow actually needs to ingest large external drafts.

### Global variables / shared context

`{{Style guide}}` and `{{Cast bible}}` each fan out to ~6–10 nodes via individual edges. That clutters the canvas. Want: named globals visible to every node by reference, not via edge.

Implementation sketch: a small key-value store on the project, with `{{global:name}}` substitution in `replaceTemplates`. The "global" prefix avoids collisions with node-title placeholders.

Status: nice-to-have, doesn't block anything functionally — fiction-arc works with explicit edges thanks to cross-parent resolution. Worth doing once template authors actually hit the spaghetti threshold.

### Retry-on-invalid-JSON for general `text` nodes

Currently `text` nodes with `responseSchema` that return invalid JSON throw and the node lands in `ERROR`. The new `llm-split` has retry baked in. Other places that want structured output (e.g. a future JSON-reformat stage) would benefit from the same.

Status: small, isolated change. Not blocking fiction-arc (it doesn't use `responseSchema` on text nodes — the `llm-split` with `partDescription` absorbs that need). Implementation if needed: extract the retry loop from `generateSplitParts` into a helper, reuse from `generatePlanNodeTextContent` when `responseSchema` is set.

## Open — speculative

### File input node

A node type whose content comes from an uploaded file (synopsis.md, existing draft, transcript). Currently the only way to get external content in is to paste into a `text` node manually. Useful for "doctor my existing 30kb draft" workflows. Not in current scope.

### Best-of-N / branching

Generate N alternative versions of a scene, let the user pick. Graph doesn't support this — would need new edge semantics (textArray-of-alternatives) or a UI for selection over multiple iterations. Niche enough to ignore until someone asks.

## Explicitly NOT planned

### `parse-array` (deterministic JSON parser node)

Briefly considered as a way to factor JSON parsing out of `llm-split`. Dropped: there is no other path in the system that produces JSON-as-text on an edge, so a standalone parser would never be reached. If a future workflow needs to consume JSON from a non-LLM source (e.g. a `file-input` node returning JSON), revisit.

### `regex-split` as a separate utility

Discussed as a tiny deterministic counterpart to `llm-split`. Dropped per user direction: regex was the previous default, the user actively didn't want it back. If a future workflow has a guaranteed-deterministic-format input, the user can do the split outside the graph.

### Structured output type on `text` nodes

Adding an "output as textArray" option to the regular `text` node was considered. Dropped: `llm-split` is a cleaner abstraction (verb-first naming, distinct settings, distinct UI) than overloading `text`. Two node types with non-overlapping intent beat one node type with a mode switch.
