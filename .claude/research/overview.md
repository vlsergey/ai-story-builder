# Project overview

> Last verified: 2026-05-13. Re-check before relying on file paths and line numbers.

AI Story Builder is an Electron desktop app for AI-assisted creative writing. The core idea is a **node-and-edge graph of LLM operations**: users compose pipelines like "outline → split into chapters → for-each chapter generate prose → merge to manuscript", and a regeneration engine pushes content through that graph reactively.

## Tech stack

- **Runtime**: Electron (main process in `src/backend/main.ts`, renderer in `src/frontend/`).
- **Backend**: TypeScript built with tsup. Logic in plain functions/services; tRPC router exposes them over Electron IPC.
- **Frontend**: React 19 + Vite + Tailwind. tRPC React Query client. Dockview for panel layout. `react-complex-tree` for lore tree. React Flow for plan graph.
- **Persistence**: SQLite via `better-sqlite3`. Schema lives in [`src/backend/db/schema.sql`](../../src/backend/db/schema.sql) (auto-generated; do not hand-edit); evolution via numbered migrations in [`src/backend/db/migrations/`](../../src/backend/db/migrations/).
- **AI providers**: Yandex Cloud and Grok (xAI). Unified through an adapter interface — see [`ai-integration.md`](ai-integration.md).

## Directory map

```
src/
  backend/
    ai/             # provider adapters + prompt building + streaming
    db/             # better-sqlite3 wiring, schema.sql, migrations/001..026
    lore/           # lore tree CRUD (mostly TODO — see lore.md)
    plan/
      edges/        # plan_edges repository + routes
      nodes/
        graph/      # NodeProcessor implementations, one per node type
        generate/   # regeneration engine: tree walker + per-node context
    projects/       # project lifecycle: create, export, apply template
    routes/         # legacy/misc routes (ai-billing, ai-sync, generate-lore)
    settings/       # global app settings + per-project settings
    router.ts       # tRPC router — single entry point for all RPC procedures
    main.ts         # Electron main process; mounts tRPC IPC handler
  frontend/src/
    plan/           # plan graph editor (React Flow)
    lore/           # lore tree UI
    projects/       # start screen, project wizard, template browser
    ipcClient.ts    # createTRPCReact<AppRouter>() — single tRPC client
  shared/           # types shared between backend and frontend (rows, enums)
  schemas/          # JSON Schemas for project templates and node/edge types
```

## High-level flow

1. **Project open**: backend opens SQLite file in `<userData>/projects/<slug>/db.sqlite`, runs pending migrations, populates `SettingsRepository`. tRPC router is bound to the BrowserWindow ([main.ts:354-360](../../src/backend/main.ts#L354-L360)).
2. **User builds a graph**: in the plan editor, creates `text`, `split`, `merge`, `for-each` nodes and connects them with edges (`text` or `textArray` typed). See [`plan-graph.md`](plan-graph.md).
3. **User triggers regeneration**: `aiGenerate` subscription kicks off the regeneration engine; per-node processors compute outputs, AI calls stream tokens, downstream nodes auto-mark `OUTDATED`.
4. **User exports as template**: graph + lore folders → JSON file with wizard pages. New projects can be created from a template; wizard answers fill `${VARNAME}` placeholders in prompts. See [`project-templates.md`](project-templates.md).

## Things that drifted from older notes

- **Transport is tRPC over Electron IPC**, not a custom `invoke` wrapper. `electron-trpc/main` is used in [main.ts:357](../../src/backend/main.ts#L357); frontend uses `ipcLink` from `electron-trpc/renderer` ([App.tsx:9](../../src/frontend/src/App.tsx#L9)).
- **Migrations exist and number 26** (as of this writing) — the "no migrations until first release" rule from older docs no longer applies. Fresh DBs load `schema.sql` directly; existing DBs go through numbered migration steps. See [`data-model.md`](data-model.md).
- **Lore integration is a TODO**, not "minimal implementation": there is a `LoreProcessor` in the registry but it does not actually inject lore content into prompts. See [`lore.md`](lore.md).
- **Legacy tables linger**: `card_definitions`, `card_values`, `story_parts` are in the initial schema but only used in migration 001 and migration tests. Unused by the app.

## Cross-references

- [`plan-graph.md`](plan-graph.md) — node types, edges, processors, regeneration engine
- [`ai-integration.md`](ai-integration.md) — providers, prompt building, streaming
- [`project-templates.md`](project-templates.md) — export/apply format (target of imminent refactor)
- [`data-model.md`](data-model.md) — DB schema, uniqueness, legacy tables
- [`lore.md`](lore.md) — lore tree (mostly TODO)
