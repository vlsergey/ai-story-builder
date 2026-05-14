# Data model and persistence

> Last verified: 2026-05-14. Re-check before relying on file paths and line numbers.

## Storage

SQLite via `better-sqlite3`. One DB file per project, in `<userData>/projects/<slug>/db.sqlite`. App-level config (recent projects, global settings) lives in a separate state DB managed by [`src/backend/db/state.ts`](../../src/backend/db/state.ts).

## Schema source of truth

[`src/backend/db/schema.sql`](../../src/backend/db/schema.sql) is the **fresh-database** schema. **Auto-generated** by `npm run generate-schema` — do not hand-edit. For changes, write a new migration in [`src/backend/db/migrations/NNN.ts`](../../src/backend/db/migrations/), bump `CURRENT_VERSION` in [`migrations.ts`](../../src/backend/db/migrations.ts), then regenerate `schema.sql`.

28 migrations exist as of this writing. The "no migrations until first release" rule from older docs no longer applies — there is no longer a single editable initial schema. The two most recent reshape how prompts and split configs are stored:

- **027** — legacy regex-based `split` nodes converted to LLM-driven splits; `node_type_settings.separator/dropFirst/dropLast` translated into a natural-language prompt and moved to `ai_user_prompt` (later relocated again — see 028).
- **028** — `ai_user_prompt` and `ai_system_prompt` columns **dropped** from both `plan_nodes` and `lore_nodes`. For LLM-call types (`text`, `split`, `lore`) those values now live inside `node_type_settings.userPrompt` / `.systemPrompt`. `fix-problems` keeps its own named prompt fields in its settings. Other node types warn-and-drop on any stale prompt value.

## Tables in active use

- **`plan_nodes`** — graph nodes. Self-referencing `parent_id` for containers. No DB-level title uniqueness. See [`plan-graph.md`](plan-graph.md).
- **`plan_edges`** — graph edges. `from_node_id` / `to_node_id` with `ON DELETE CASCADE`.
- **`lore_nodes`** — lore tree. `UNIQUE (parent_id, title)`. See [`lore.md`](lore.md).
- **`settings`** — key-value store for per-project settings.

## Legacy tables (in schema, unused at runtime)

- `card_definitions`, `card_values`, `story_parts` — from an earlier card-driven design. Created by migration 001, never referenced outside the initial schema and migration tests. Safe to consider dead.

## Uniqueness summary

| Table | Unique constraint on title? |
|---|---|
| `lore_nodes` | yes — `UNIQUE (parent_id, title)` at SQL level |
| `plan_nodes` | **no** SQL constraint; templates enforce **global uniqueness** in code (except `for-each-input` / `for-each-output` which are exempt by design) |

The application-side strategy (option 2 from the original three-way choice) was the one taken — see [`project-templates.md`](project-templates.md) for the resolution rules used by export and apply.

## Tests

- [`src/backend/db/migrations.test.ts`](../../src/backend/db/migrations.test.ts) — golden test that runs migrations 0→N and compares the resulting schema to `schema.sql`.
- [`src/backend/db/backup.test.ts`](../../src/backend/db/backup.test.ts) — backup roundtrip.

Backend tests call repositories and services directly (no HTTP); see `setupDb()` helpers in test files and [`test-db-utils.ts`](../../src/backend/db/test-db-utils.ts).

## Transport (separate from persistence)

tRPC over Electron IPC. Backend router: [`src/backend/router.ts`](../../src/backend/router.ts). Frontend client: [`src/frontend/src/ipcClient.ts`](../../src/frontend/src/ipcClient.ts). The handler is mounted in [`main.ts`](../../src/backend/main.ts#L357) via `electron-trpc/main.createIPCHandler`. Renderer uses `ipcLink` from `electron-trpc/renderer` ([App.tsx:9](../../src/frontend/src/App.tsx#L9)).

Subscriptions over IPC carry event streams (node updates, AI generation events, regeneration status) — see how `loreEventManager`, `planNodeEventManager`, `lastAiGenerationEventManager` expose `.asSubscription()` in the router.
