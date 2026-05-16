# AI Story Builder

A local desktop tool for AI-assisted long-form fiction generation. Build a node-graph pipeline, feed it a synopsis, get back a finished novella. Original prose, fanfic, AU, what-if — same pipeline.

Everything runs locally: an Electron app with a SQLite database on your disk and direct calls to the LLM provider of your choice (Grok and Yandex GPT supported today). No cloud sync, no central server, no telemetry.

---

## What you can do

- **Turn a one-paragraph synopsis into a ~30 000-word novella** using the bundled `fiction-arc` template. See [What ships in the box](#what-ships-in-the-box) below.
- **Author your own templates** as JSON: graphs of `text`, `split`, `merge`, `for-each`, `fix-problems`, `lore` and a couple of for-each-internal nodes. Wizard pages collect inputs from the user when a project is instantiated.
- **Maintain a Lore tree** alongside the plan graph — characters, world rules, settings — that survives across generations and informs prompts.
- **Iterate on individual nodes** in the canvas: edit a prompt, re-generate that node only, see the downstream nodes go `OUTDATED` and re-run them when ready.
- **Run review/fix loops** with `fix-problems` nodes: a node finds issues in another node's output and rewrites it, repeating until problems fall below a severity threshold.
- **Trace generations** in the visual canvas with React Flow — pan, zoom, hierarchical auto-layout.

---

## Quick start

```bash
npm install
npm run dev
```

Launches the Vite frontend dev server, builds the backend, and opens the Electron window. The packaged build:

```bash
npm install
npm run build
npm run package
```

Output lands in `release/` (Windows installer, AppImage on Linux, `.dmg` on macOS).

You'll need an API key for at least one AI provider — Grok or Yandex GPT — entered through the in-app settings.

---

## What ships in the box

### The `fiction-arc` template

[`src/backend/resources/resources/templates/fiction-arc.ru.json`](src/backend/resources/resources/templates/fiction-arc.ru.json) — a 37-node graph that takes a single Russian-language synopsis and produces a novella of roughly 30 000 words across 20 scenes. The pipeline:

1. **Bootstrap from synopsis** — theme, genre, world (with explicit canon / AU / what-if handling), style guide, character roster with a genre-aware "anchor" schema (age, gender, plus whatever else the genre needs).
2. **Plot outline** — 20 beats, Save the Cat stretched, with explicit setup/payoff registry and a fix-problems review pass for orphans and motivation gaps.
3. **First-draft scenes** — `for-each` over the 20 beats. Each beat gets its own scene plan, director notes (subtext, sensory anchors, opening/closing line), prose generation with all prior scenes visible for continuity, and a polishing fix-problems pass.
4. **Second-draft scenes** — second `for-each` over the same beats with the full first draft visible. Tightens foreshadowing, echoes motifs, resolves cross-arc inconsistencies.
5. **Final merge** — single document with `## Часть N` headers.

Expected run time: roughly 3–4 hours on a single Grok API key, dominated by the prose-generation calls.

The template authoring quality bar lives in [`TEMPLATE_CHECKS.md`](src/backend/resources/resources/templates/TEMPLATE_CHECKS.md): rules covering output sizing, cache-friendly prompt ordering, structured-list safeguards, fanfic-vs-original handling, classification-node guards, forbidden invented quotes, foreign-language insertion detection in fix-problems, and more — accumulated from real run failures, not from theory.

A growing portion of those rules is enforced automatically by [`templates-structure.test.ts`](src/backend/resources/resources/templates/templates-structure.test.ts) on every commit.

### Generated examples

Real end-to-end runs — synopsis, wizard settings, LLM parameters, total time and cost, full prose output — are collected under [`examples/`](examples/). Browse the folder to see what the bundled template actually produces at different settings.

Export your own run with [`scripts/export-project-to-md.ts`](scripts/export-project-to-md.ts):

```bash
npx tsx scripts/export-project-to-md.ts \
  --project "Письмо" \
  --template fiction-arc.ru.json \
  --genre "литдрама" \
  --final-node "Сборка драфта"
```

`--final-node` is the title of the plan node that holds the finished prose — different templates use different titles, so the script asks you explicitly.

The script writes `<projectName> [<tags>].md` next to your project's `.sqlite`, with a preamble of all wizard inputs, LLM settings, and aggregated telemetry, then the final assembled prose. Copy the resulting file into `examples/` to publish a run.

---

## How it works

### Plan graph

A project's plan is a graph of typed nodes connected by typed edges (`text`, `textArray`). Every node has a regeneration processor:

| Type | What it does |
|---|---|
| `text` | LLM call; prompt in `node_type_settings.userPrompt`, supports `{{Title}}` substitution from input edges |
| `split` | LLM call returning `{parts: string[]}`; optional `partDescription` injected into the response schema |
| `merge` | Joins a textArray into a single text deterministically |
| `for-each` | Container; iterates an inner subgraph over an incoming textArray |
| `for-each-input` / `for-each-output` / `for-each-index` / `for-each-prev-outputs` | Iteration-internal helpers (auto / opt-in) |
| `fix-problems` | Iterative find-then-fix loop with severity threshold and max-iterations cap |
| `lore` | Placeholder node tied to the lore subsystem |

Nodes have a status (`EMPTY`, `MANUAL`, `GENERATING`, `GENERATED`, `OUTDATED`, `ERROR`) that drives the regeneration scheduler.

Deep dive: [`.claude/research/plan-graph.md`](.claude/research/plan-graph.md).

### Lore tree

A separate hierarchical store for facts about the world — characters, locations, rules, terminology — that doesn't fit in any one plan node. Accessible from the canvas, hand-editable, persists across regenerations.

Deep dive: [`.claude/research/lore.md`](.claude/research/lore.md).

### Templates

JSON files validated against [`src/schemas/project-template.json`](src/schemas/project-template.json). Used for both bundled "system" templates (read-only, shipped with the app) and user-saved templates exported from a working project. References between nodes are by title — no IDs in the format. Cross-parent edges work (a top-level node feeding into a node inside a `for-each`) thanks to a sibling-first-then-global title resolution.

Deep dive: [`.claude/research/project-templates.md`](.claude/research/project-templates.md).

### AI integration

Provider-adapter pattern. Each provider implements `generateResponse` over `streamResponse`. Currently shipped:

- **Grok** — via the OpenAI-compatible API. Streaming response events, structured output via JSON schema, prompt caching.
- **Yandex GPT** — Yandex Cloud's own protocol.

Adding a third provider is a single file under `src/backend/ai/` plus a registration line.

Deep dive: [`.claude/research/ai-integration.md`](.claude/research/ai-integration.md).

---

## Development

### Workspace layout

```
src/
  frontend/          React + Vite + xyflow + shadcn UI
  backend/           Node + better-sqlite3 + tsup
  preload/           Electron preload script
  shared/            Auto-generated types from JSON schemas
  schemas/           JSON schemas (source of truth)
.claude/research/    Architecture notes — module maps, design decisions
scripts/             Codegen, schema generation, template layout
```

Detail map: [`.claude/research/overview.md`](.claude/research/overview.md).

### Scripts

```bash
npm run dev                   # Electron + Vite hot-reload
npm run build                 # build frontend + backend
npm run package               # Electron Builder packaging
npm test                      # all tests across both workspaces
npm run typecheck             # tsc on both workspaces
npm run lint / lint:fix       # Biome
npm run generate-code         # JSON schemas → TS types
npm run generate-schema       # migrations → schema.sql
tsx scripts/layout-templates.ts   # rerun ELK layout on bundled templates
```

### Testing

`vitest` in both workspaces. Backend tests cover migrations, repository, template apply/export, processor behavior, and template structure. Frontend has a small set of render-smoke tests. The end-to-end diagnostic [`fiction-arc.diagnostic.test.ts`](src/backend/resources/resources/templates/fiction-arc.diagnostic.test.ts) mocks every LLM call and runs the full bundled template — useful for catching orchestration regressions without burning API credits.

A note on Electron: `npm run dev` rebuilds `better-sqlite3` for Electron's Node ABI, which is incompatible with system Node. If the test suite refuses to load the native module, close the running dev app and re-run `npm rebuild better-sqlite3`.

### Authoring templates

Read [`TEMPLATE_CHECKS.md`](src/backend/resources/resources/templates/TEMPLATE_CHECKS.md) before writing one — it captures every LLM-handling lesson we've earned the hard way. The structural test will catch mechanical mistakes; the checklist captures the judgement calls.

Templates live as JSON under `src/backend/resources/resources/templates/`. After structural changes run `tsx scripts/layout-templates.ts` to refresh canvas coordinates; a test will flag stale coordinates if you forget.

---

## Repository conventions

- Database changes go through migrations in [`src/backend/db/migrations/`](src/backend/db/migrations) — never edit initial `CREATE TABLE` statements. The schema file is auto-generated.
- Architecture notes worth keeping across sessions live in [`.claude/research/`](.claude/research/) — one topic per file, English, date-stamped.
- See [`CLAUDE.md`](CLAUDE.md) for the full set of project conventions used during development.

---

## License

Apache License 2.0. See [`LICENSE`](LICENSE) for the full text.

---

## Status

Pre-alpha. The fiction-arc template is the only bundled one and is actively being refined against real generations. Expect rough edges, especially in the canvas UX. Filing structured issues with concrete reproductions is the most useful contribution right now.
