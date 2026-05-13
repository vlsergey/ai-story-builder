# Graph primitives — gaps and deferred work

> Last verified: 2026-05-13. Re-check before relying on file paths and line numbers.

Gaps in the node/edge primitive set that surfaced while designing the fiction generation pipeline (see [`fiction-arc-pipeline.md`](fiction-arc-pipeline.md)). Listed in order of impact, with the status of each.

## Done

### LLM-driven split (commit `fbdbe20`)

The `split` node now does an LLM call returning `{parts: string[]}` with retry-on-invalid-JSON. The "how to split" prompt lives in `plan_nodes.ai_user_prompt` like other LLM-powered nodes. Implementation in [`src/backend/plan/nodes/graph/split-processor.ts`](../../src/backend/plan/nodes/graph/split-processor.ts) + helper [`src/backend/ai/generate-split-parts.ts`](../../src/backend/ai/generate-split-parts.ts). Migration 027 ([`src/backend/db/migrations/027.ts`](../../src/backend/db/migrations/027.ts)) translates legacy regex configs to natural-language prompts.

Why this was the priority: regex split is fragile when the upstream format drifts; LLM split absorbs that drift. The fiction pipeline needs to split free-prose outlines into beats, where the prose may number them as "1.", or as "Beat 1:", or as h3 headings — regex can't generalize across forms.

## Open — deferred but planned

### `llm-boundary-split` — for splitting large existing inputs

The current `llm-split` (post-refactor) asks the LLM to **emit each chunk verbatim** in the JSON output. That breaks for inputs that exceed the LLM's output cap (~1500 words on Grok). E.g. a user pasting a 15kb existing draft and asking the system to split it into scenes — the output array alone exceeds the cap.

Solution: a separate node type that asks the LLM only for **boundary markers** (line indices, or "the line that starts each piece"), then the runtime does the cutting against the original input. Output stays small (20 anchors × 20 words = 400 words), input fidelity is exact.

Status: **not blocking** for the fiction pipeline (every input in that pipeline is small enough for the regular `llm-split`). Deferred until a workflow actually needs it.

### Global variables / shared context

`{{Style guide}}` currently propagates to ~25 downstream nodes via 25 edges. That clutters the canvas. Want: named globals visible to every node by reference, not via edge.

Implementation sketch: a small key-value store on the project, with `{{global:name}}` substitution in `replaceTemplates`. The "global" prefix avoids collisions with node-title placeholders.

Status: nice-to-have, doesn't block anything functionally. Worth doing once template authors hit the spaghetti threshold (~10 fan-out edges from one node).

### Retry-on-invalid-JSON for general `text` nodes

Currently `text` nodes with `responseSchema` that return invalid JSON throw and the node lands in `ERROR`. The new `llm-split` has retry baked in. Other places that want structured output (e.g. the JSON-reformat stage in the two-step pattern from [[project-json-schema-dumbs-models]]) would benefit from the same.

Status: small, isolated change. Worth doing before the fiction pipeline goes to production. Implementation: extract the retry loop from `generateSplitParts` into a helper, reuse from `generatePlanNodeTextContent` when `responseSchema` is set.

## Open — speculative

### File input node

A node type whose content comes from an uploaded file (synopsis.md, existing draft, transcript). Currently the only way to get external content in is to paste into a `text` node manually. Useful for "doctor my existing 30kb draft" workflows. Not in current scope.

### Best-of-N / branching

Generate N alternative versions of a scene, let the user pick. Graph doesn't support this — would need new edge semantics (textArray-of-alternatives) or a UI for selection over multiple iterations. Niche enough to ignore until someone asks.

### Cross-parent edges in templates

Edges that cross container boundaries (e.g. a top-level node feeding into a node inside a for-each) are rejected during template export — see [`project-templates.md`](project-templates.md). If a real use case appears, the template format will need path-based references (`ParentTitle/ChildTitle`) instead of sibling-scoped lookup. Currently rejected with a clear error, sufficient for now.

## Explicitly NOT planned

### `parse-array` (deterministic JSON parser node)

Briefly considered as a way to factor JSON parsing out of `llm-split`. Dropped: there is no other path in the system that produces JSON-as-text on an edge, so a standalone parser would never be reached. If a future workflow needs to consume JSON from a non-LLM source (e.g. a `file-input` node returning JSON), revisit.

### `regex-split` as a separate utility

Discussed as a tiny deterministic counterpart to `llm-split`. Dropped per user direction: regex was the previous default, the user actively didn't want it back. If a future workflow has a guaranteed-deterministic-format input, the user can do the split outside the graph.

### Structured output type on `text` nodes

Adding an "output as textArray" option to the regular `text` node was considered. Dropped: `llm-split` is a cleaner abstraction (verb-first naming, distinct settings, distinct UI) than overloading `text`. Two node types with non-overlapping intent beat one node type with a mode switch.
