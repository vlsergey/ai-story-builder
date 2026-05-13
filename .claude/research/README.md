# Architecture research notes

Persistent findings from code exploration: module maps, data-flow traces, refactor plans, design decisions. One topic per file, descriptive kebab-case names. English only. Always include file paths with line numbers, and date-stamp each note so future sessions can judge staleness.

Convention is documented in [`/CLAUDE.md`](../../CLAUDE.md) under "Architecture research notes".

## Index

- [`overview.md`](overview.md) — high-level architecture, tech stack, directory map, drift from older docs.
- [`plan-graph.md`](plan-graph.md) — node types, edges, processors, regeneration engine, title-based prompt refs.
- [`ai-integration.md`](ai-integration.md) — provider adapter pattern, prompt building, streaming lifecycle.
- [`project-templates.md`](project-templates.md) — export/apply flow, ID surface area (refactor target), wizard variables, uniqueness gap.
- [`lore.md`](lore.md) — lore tree (mostly TODO).
- [`data-model.md`](data-model.md) — SQLite schema, migrations, legacy tables, transport (tRPC over IPC).
