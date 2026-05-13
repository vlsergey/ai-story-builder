# Plan graph: nodes, edges, processors, regeneration engine

> Last verified: 2026-05-13. Re-check before relying on file paths and line numbers.

## Data model

Two SQLite tables drive the plan graph: `plan_nodes` and `plan_edges`. TypeScript row types are in [`src/shared/plan-graph.ts`](../../src/shared/plan-graph.ts).

`plan_nodes` fields worth remembering:
- `id`, `parent_id` — primary key and self-reference for containers (e.g. for-each children).
- `title` — human label. **No DB-level uniqueness** (`lore_nodes` has `UNIQUE(parent_id, title)` but `plan_nodes` does not).
- `type` — one of the values in [`src/shared/plan-node-types.ts`](../../src/shared/plan-node-types.ts).
- `content` — current output (string for most types; JSON-encoded `ForEachNodeContent` for `for-each`).
- `ai_user_prompt`, `ai_system_prompt` — prompt template strings.
- `node_type_settings` — JSON, per-type settings (e.g. split regex, merge headers).
- `ai_settings` — JSON, per-node AI overrides (model, max tokens, etc.).
- `x`, `y`, `width`, `height` — React Flow canvas coordinates.
- `status` — `EMPTY | GENERATING | GENERATED | MANUAL | OUTDATED | ERROR`.
- `in_review`, `review_base_content` — review workflow for accept/reject.

`plan_edges`:
- `from_node_id`, `to_node_id` — endpoints; `ON DELETE CASCADE` to `plan_nodes`.
- `type` — `text` or `textArray`. See [`src/shared/plan-edge-types.ts`](../../src/shared/plan-edge-types.ts).
- `position` — ordering for multiple incoming edges of the same type.
- `label`, `template` — currently unused fields (label is in schema, template was added but I haven't seen it consumed; verify before deleting).

## Node types

Defined as TypeScript constants in [`src/shared/plan-node-types.ts`](../../src/shared/plan-node-types.ts) (auto-generated from `src/schemas/plan-node-types.json`):

| Type | Container? | Purpose |
|---|---|---|
| `text` | no | LLM-generated text. The workhorse. Reads inputs via `{{NodeTitle}}` placeholders in prompts. |
| `split` | no | Splits a `text` input into a `textArray` by a regex separator. |
| `merge` | no | Concatenates multiple `text` inputs (or a `textArray`) into one `text`. Settings control optional section headers. |
| `for-each` | **yes** | Iterates over a `textArray` input. Holds child nodes that run per element. Stores per-iteration overrides in its `content` JSON. |
| `for-each-input` | no, confined | Auto-created inside `for-each`. Exposes the current array element as a `text` output. |
| `for-each-output` | no, confined | Auto-created inside `for-each`. Collects per-iteration outputs into a `textArray`. |
| `for-each-prev-outputs` | no, confined | Access previously generated outputs during iteration (for sequence-aware generation). |
| `lore` | no | Should inject lore content. Currently passthrough — see [`lore.md`](lore.md). |
| `fix-problems` | no | Re-runs an LLM call to fix validation errors flagged by a downstream check. |

Container vs non-container split is enforced in the schema and used by the UI to allow nesting. Confined nodes can't be moved out of their parent ([plan-node-service.ts:339-342](../../src/backend/plan/nodes/plan-node-service.ts#L339-L342)).

## Processors

Each node type has one processor implementing [`NodeProcessor<S>`](../../src/backend/plan/nodes/graph/node-processor.ts):

- `defaultSettings: S` — base settings, merged with `node_type_settings` JSON from the DB.
- `getOutput(service, node)` — returns the node's current content typed by its outgoing edge (string for `text`, string[] for `textArray`). **Pure read, no recomputation.**
- `onUpdate?(service, id, oldNode, newNode, settings)` — invoked when the node's own row changes; can return a follow-up patch (e.g. recompute summary).
- `onInputContentChange?(service, node, changedInputId, settings)` — invoked when an upstream node's content changed. Returns a patch (e.g. `{ status: 'OUTDATED' }`). For `text`, this checks whether the changed node's `title` appears as `{{Title}}` in the prompt ([text-processor.ts:36-48](../../src/backend/plan/nodes/graph/text-processor.ts#L36-L48)).
- `regenerate?(service, context, node, settings)` — heavy work: AI call, re-split, re-merge. Returns a patch (typically `{ content }`).

Registry in [`plan-node-service.ts:42-52`](../../src/backend/plan/nodes/plan-node-service.ts#L42-L52):

```ts
NODE_PROCESSORS: Record<PlanNodeType, NodeProcessor> = {
  "fix-problems": new FixProblemsProcessor(),
  "for-each": new ForEachProcessor(),
  "for-each-input": new ForEachInputProcessor(),
  "for-each-output": new ForEachOutputProcessor(),
  "for-each-prev-outputs": new ForEachPrevOutputsProcessor(),
  text: new TextProcessor(),
  lore: new LoreProcessor(),
  split: new SplitProcessor(),
  merge: new MergeProcessor(),
}
```

Processor files live in [`src/backend/plan/nodes/graph/`](../../src/backend/plan/nodes/graph/), one per node type.

## Title-based input references in prompts

**Important for the templates refactor**: prompt strings reference inputs by **title**, not id. The `text` processor checks `instructions.includes('{{${title}}}')` in `onInputContentChange` ([text-processor.ts:36](../../src/backend/plan/nodes/graph/text-processor.ts#L36)). So titles already act as a stable identity inside prompts — switching templates from id-based to title-based references is in line with how the runtime already works.

The actual prompt substitution happens during generation in [`src/backend/ai/generate-plan-node-text-content.ts`](../../src/backend/ai/generate-plan-node-text-content.ts) via [`src/backend/ai/replaceTemplates.ts`](../../src/backend/ai/replaceTemplates.ts).

## Regeneration engine

Entry point: [`src/backend/plan/nodes/generate/regenerateTreeNodesContents.ts`](../../src/backend/plan/nodes/generate/regenerateTreeNodesContents.ts). Coordinates:

- Walks a subtree of nodes (one node id + its dependencies).
- Maintains a status stream (`inProcess`, `currentStack`, errors) via event emitter — surfaced to UI through tRPC subscription `plan.nodes.aiGenerate.*` (built by [`regenerate-routes.ts`](../../src/backend/plan/nodes/generate/regenerate-routes.ts)).
- Honors an `AbortSignal` for user-initiated cancel.
- Tracks a `currentStack` for nested for-each iterations.

The single-node regenerate method is [`PlanNodeService.regenerate`](../../src/backend/plan/nodes/plan-node-service.ts#L430-L506): sets status to `GENERATING`, delegates to the processor's `regenerate`, then settles to `GENERATED` / `EMPTY` / `OUTDATED` based on resulting content and abort state. Optionally generates a summary (if `auto_generate_summary` setting is on).

## Downstream propagation

When a node's content changes, [`PlanNodeService.markAsOutdatedAndNotifyDownstreamNodes`](../../src/backend/plan/nodes/plan-node-service.ts#L164-L195) walks outgoing edges and calls each downstream processor's `onInputContentChange`. Skipped fields (no propagation) are listed in `DO_NOT_NOTIFY_DOWNSTREAMS_ON_CHANGES_IN` ([line 54](../../src/backend/plan/nodes/plan-node-service.ts#L54)) — purely visual fields (x, y, width, height, word/char/byte counts) don't trigger propagation.

## Events to the frontend

`planNodeEventManager` ([plan-node-event-manager.ts](../../src/backend/plan/nodes/plan-node-event-manager.ts)) emits `NodeUpdateEvent { nodeId, updatedFields }` on every change. Frontend subscribes via tRPC subscription and patches its local state.
