# Data model and persistence

> Last verified: 2026-05-13. Re-check before relying on file paths and line numbers.

## Storage

SQLite via `better-sqlite3`. One DB file per project, in `<userData>/projects/<slug>/db.sqlite`. App-level config (recent projects, global settings) lives in a separate state DB managed by [`src/backend/db/state.ts`](../../src/backend/db/state.ts).

## Schema source of truth

[`src/backend/db/schema.sql`](../../src/backend/db/schema.sql) is the **fresh-database** schema. **Auto-generated** by `npm run generate-schema` — do not hand-edit. For changes, write a new migration in [`src/backend/db/migrations/NNN.ts`](../../src/backend/db/migrations/), bump `CURRENT_VERSION` in [`migrations.ts`](../../src/backend/db/migrations.ts), then regenerate `schema.sql`.

26 migrations exist as of this writing. The "no migrations until first release" rule from older docs no longer applies — there is no longer a single editable initial schema.

## Tables in active use

- **`plan_nodes`** — graph nodes. Self-referencing `parent_id` for containers. No DB-level title uniqueness. See [`plan-graph.md`](plan-graph.md).
- **`plan_edges`** — graph edges. `from_node_id` / `to_node_id` with `ON DELETE CASCADE`.
- **`lore_nodes`** — lore tree. `UNIQUE (parent_id, title)`. See [`lore.md`](lore.md).
- **`settings`** — key-value store for per-project settings.

## Legacy tables (in schema, unused at runtime)

- `card_definitions`, `card_values`, `story_parts` — from an earlier card-driven design. Created by migration 001, never referenced outside the initial schema and migration tests. Safe to consider dead.

## Uniqueness summary (relevant to template refactor)

| Table | Unique constraint on title? |
|---|---|
| `lore_nodes` | yes — `UNIQUE (parent_id, title)` |
| `plan_nodes` | **no** |

If the templates refactor switches plan-node references from id to title, plan-node titles will need to become unique. Three options to enforce:
1. Add a DB-level `UNIQUE (parent_id, title)` constraint to `plan_nodes` (new migration) — mirrors lore behavior.
2. Application-level validation in export and apply paths only — leaves the DB tolerant but the format strict.
3. Sibling-scoped uniqueness with path disambiguation (`Parent/Child`) for cross-container references.

## Tests

- [`src/backend/db/migrations.test.ts`](../../src/backend/db/migrations.test.ts) — golden test that runs migrations 0→N and compares the resulting schema to `schema.sql`.
- [`src/backend/db/backup.test.ts`](../../src/backend/db/backup.test.ts) — backup roundtrip.

Backend tests call repositories and services directly (no HTTP); see `setupDb()` helpers in test files and [`test-db-utils.ts`](../../src/backend/db/test-db-utils.ts).

## Transport (separate from persistence)

tRPC over Electron IPC. Backend router: [`src/backend/router.ts`](../../src/backend/router.ts). Frontend client: [`src/frontend/src/ipcClient.ts`](../../src/frontend/src/ipcClient.ts). The handler is mounted in [`main.ts`](../../src/backend/main.ts#L357) via `electron-trpc/main.createIPCHandler`. Renderer uses `ipcLink` from `electron-trpc/renderer` ([App.tsx:9](../../src/frontend/src/App.tsx#L9)).

Subscriptions over IPC carry event streams (node updates, AI generation events, regeneration status) — see how `loreEventManager`, `planNodeEventManager`, `lastAiGenerationEventManager` expose `.asSubscription()` in the router.
