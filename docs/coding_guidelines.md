# Coding Guidelines

To keep the project maintainable and scalable, follow these rules:

* **Backend structure** – Organize server code by entity. Each major domain (projects, folders, lore, plan, generated parts, etc.) should live in its own subdirectory under `src/backend`.  
  Within each directory, put individual route handlers in separate files (e.g. `create.js`, `list.js`, `move.js`).  Import and assemble them in a central router.  Avoid a monolithic `projectRoutes.js` file.
* **Frontend structure** – Use a component-per-file approach and prefer functional components with hooks. Keep styling using Tailwind util classes or shadcn/ui patterns.
* **Theming & I18n** – All user-facing text strings must be internationalised using the `useLocale()` hook (`t(key)`) and stored in UTF-8 JSON locale files under `src/frontend/src/i18n/`.  Do not inline user-visible strings directly in JSX.  Every new i18n key must be added to **both** `en.json` and `ru.json` at the same time — the project supports English and Russian, and both translations must be provided upfront.
* **URL routing** – UI must reflect application state in the URL (React Router is used).  Reloading the page should not reset to the start screen.
* **Styling** – Follow the design system (Shadcn/ui + Tailwind). Tree views, buttons, forms, and panels must look polished; do not leave plain black text on white.
* **Interactive docking** – Panels should be implemented with a docking/window library or custom drag/resize handlers. Users must be able to reposition and dock panels via drag‑drop.
* **Dependency management** – Frontend and backend must have separate `package.json` files to maintain clear separation of concerns. Dependencies should be installed only in the relevant workspace.

* **HTTP error codes** – Use the correct status code for each failure:
  * `400 Bad Request` – missing or invalid parameters supplied by the client.
  * `404 Not Found` – requested resource does not exist.
  * `409 Conflict` – the operation conflicts with the current state (e.g. duplicate name).
  * `500 Internal Server Error` – an unexpected server-side failure only (unhandled exception, I/O error, etc.).
  Returning `500` because of wrong UI state or invalid user input is a **bug** and must be fixed, not accepted.
* **Error logging** – The backend logs a stack trace for every 4xx/5xx response automatically. Never swallow exceptions silently; always surface them as the appropriate HTTP error code with a descriptive `{ error: "..." }` JSON body.

* **Keyboard shortcuts scoped to their panel** – A global `window` keydown listener for panel-local shortcuts (e.g. Delete / Enter in the Lore Tree) must guard against events originating outside the panel. Use a container `ref` and check `containerRef.current.contains(e.target)` before processing the event. This prevents the panel's shortcuts from firing when focus is in another panel (e.g. a CodeMirror editor, a form, etc.). Keep the `INPUT` / `TEXTAREA` tag guard as well, for editable fields that live inside the same panel.

* **Database schema changes require migrations** – Never add, rename, or drop a column/table by editing the initial `CREATE TABLE` statement. All schema changes must be implemented as a new numbered migration step appended to the `MIGRATIONS` array in `src/backend/db/migrations.ts`. Each migration step:
  * Runs inside a transaction (guaranteed by `migrateDatabase`).
  * Increments `PRAGMA user_version` atomically.
  * Must be backward-compatible with existing data (use `ALTER TABLE … ADD COLUMN` with a safe default; avoid destructive changes).
  * Should backfill existing rows where the new column has a meaningful value that can be derived from existing data.
  * Test fixtures (e.g. `setupDb()` in `*.test.ts` files) must include any new columns so the tests reflect the real schema.

* **Engine-agnostic API endpoints** – API routes must not be tied to a specific AI engine (e.g. no `/api/ai/yandex/…` paths). All engine-specific operations should be exposed through engine-agnostic endpoints (e.g. `POST /api/ai/sync-lore`) that read the `current_backend` value from the project settings and dispatch to the appropriate adapter. This keeps the frontend and route structure independent of which engine is active. Engine-specific logic lives in adapter functions/modules, not in the route path.

* **Engine-specific adapter isolation** – All code specific to a particular AI provider (API call format, request construction, response parsing, streaming, error mapping) must live in dedicated adapter files per engine (e.g. `src/backend/lib/grok-adapter.ts`, `src/backend/lib/yandex-adapter.ts`). Each adapter implements a common interface (e.g. `LoreGenerateAdapter` in `lore-generate-adapter.ts`); a factory function (`getLoreAdapter`) maps an engine ID to its adapter. Routes call only the common interface and never contain `if (engine === 'grok')` branches. New engine support means adding one new adapter file and one line in the factory — nothing else.

* **External resource lifecycle** – When integrating with a third-party API (AI engine, storage service, etc.), always investigate and implement the full lifecycle of every resource created: upload, update, **and delete**. Never silently ignore deletion failures as a workaround. If a provider API does not expose a deletion endpoint:
  * Research alternative cleanup paths (e.g. removing the resource from an index/collection, deleting a parent container that cascades, using an expiration/TTL mechanism).
  * If no automated cleanup path exists, document the limitation explicitly in the code with a `// TODO:` comment and consider exposing a manual cleanup action in the UI so the user can remove orphaned resources.
  * Do **not** treat "deletion not supported" as "ignore silently" — orphaned billable resources (files, embeddings, indices) have real cost implications for the user.

* **TypeScript build architecture** – The backend uses a two-tool setup:
  * `tsc --noEmit` (`tsconfig.json`) — type-checks all `.ts` files including tests. Targets `ESNext/Bundler` to support top-level `await` in test files. Never emits output files.
  * `tsup` (`tsup.config.ts`) — production build. Bundles `server.ts` and all its imports (including `src/shared/`) into a single `dist/backend/server.js` CJS file. Native/optional modules (`better-sqlite3`, `multer`, `electron`) are kept external and resolved at runtime by Electron.

* **Build output** – `build:backend` writes only to `dist/backend/`. Source directories (`src/backend/`, `src/shared/`) never contain compiled output. `dist/` is gitignored.

* **Test file conventions** – Backend test files use top-level `await import('./foo.js')` to load modules after `vi.mock()` declarations. This requires `module: ESNext` (in `tsconfig.json`). The `.js` extension is intentional — vitest's `resolve.alias` in `vitest.config.ts` transparently redirects it to the `.ts` source.

* **CI pipeline order** – The CI runs three sequential stages per OS: `typecheck` → `test` → `package`. TypeScript errors are caught early, before the expensive Electron packaging step.

These guidelines are part of the project's acceptance criteria and should be reviewed when adding new features.