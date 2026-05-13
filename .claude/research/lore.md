# Lore tree — current state

> Last verified: 2026-05-13. Re-check before relying on file paths and line numbers.

**Lore is a big TODO.** The data model and CRUD exist, but the runtime integration into plan-node prompts is not actually wired up.

## What does exist

- `lore_nodes` table with `UNIQUE (parent_id, title)` constraint (schema.sql:44).
- Hierarchical tree, soft-delete via `to_be_deleted` flag, recursive CTE for cascade ops.
- CRUD + tree UI ([`src/frontend/src/lore/`](../../src/frontend/src/lore/)) using `react-complex-tree`.
- AI sync routes that upload lore documents to providers ([`routes/ai-sync.ts`](../../src/backend/routes/ai-sync.ts)) — but this is for attaching files to AI requests, not for prompt-string injection.
- A `LoreProcessor` registered in the plan node processor map ([plan-node-service.ts:49](../../src/backend/plan/nodes/plan-node-service.ts#L49)) — currently a passthrough placeholder.

## What does NOT exist yet

- Mechanism to inject specific lore entries into a `text` node's prompt context.
- Per-plan-node lore "scope" selection (which lore entries are relevant).
- Token-budget-aware lore retrieval (RAG-style trimming).

## Implication for refactors

Don't model the imagined "lore reference" semantics until they exist. If the project-templates refactor needs to round-trip lore — it currently only round-trips folder structure ([export-project-as-template.ts:99-127](../../src/backend/projects/export-project-as-template.ts#L99-L127)), not leaf content. Worth confirming this is intentional with the user before changing it.
