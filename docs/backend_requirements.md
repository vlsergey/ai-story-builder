## Backend Tech Stack and Functional Requirements

### Tech Stack
- Runtime: Node.js 22 LTS (Active LTS)
- Language: TypeScript (strict mode)
- Framework: Express.js
- Database: SQLite 3 with better-sqlite3 driver
- Schema migrations: PRAGMA user_version with embedded migration runner
- HTTP Client: Axios
- Configuration: dotenv + Zod schema validation
- Logging: Pino
- Desktop packaging: Electron with electron-builder

### Functional Requirements (Architecture Level)
- The application is distributed as a native desktop app (Electron) that runs on the target machine without requiring Node.js or any other runtime to be installed.
- Must support three target platforms: Windows (x64), Linux (x64), and macOS (x64 + arm64).
- The Electron main process starts the Express HTTP server, then opens a BrowserWindow pointing to it.

### Code Organization
- All API endpoints should be separated by domain/entity.  For example, routes pertaining to folders, lore, plans, versions, AI calls, etc. should live in their own directory under `src/backend` (e.g. `routes/folders.js`, `routes/lore.js`, etc.).
- Each individual endpoint implementation (e.g. `GET /folders/tree`, `POST /lore_items/:id/versions`) should reside in its own file or clearly named function to keep files small and maintainable.
- The backend project must be well‑organized overall; `server.js` should only wire middleware and import route modules, while business logic lives in separate route/handler files and utility modules.
- Shared utilities (database connection, settings, helpers) should be factored into reusable modules.
- The main `server.js` should mostly wire up middleware and import route modules rather than containing business logic.
- Each project is stored in its own SQLite database file (.sqlite). The application works with only one open project at a time.
- All user data (project databases, backups, application settings) is stored in the OS-standard user data directory via Electron's `app.getPath('userData')`. In development (plain Node.js), falls back to `<cwd>/data`.
- Automatic database backup is created before opening any project and before schema migrations (keep last 7 backups).
- Full support for multiple AI backends: Grok API, Yandex Cloud AI, Local LLM (via OpenAI-compatible HTTP endpoint), and Mock mode.
- AI configuration API (`/api/ai/*`) for managing engine credentials and selecting the active engine:
  - `GET /api/ai/config` — returns current engine list with credentials (API keys returned as-is since stored in per-user project DB)
  - `POST /api/ai/config` — saves per-engine credential fields (merged into existing JSON)
  - `POST /api/ai/current-engine` — sets the active engine; validates required fields before accepting; body: `{ engine: string | null }`
  - `POST /api/ai/:engine/test` — tests credentials against the real AI provider API; accepts credentials in request body (unsaved values allowed); uses Node.js native `fetch` (Node 18+)
- AI engine connection tests use the real provider APIs (not mocked): Grok uses `GET https://api.x.ai/v1/models`; Yandex uses `GET https://ai.api.cloud.yandex.net/v1/models` (OpenAI-compatible endpoint, returns count of available models)
- Lore sync API (`POST /api/ai/sync-lore`):
  - Reads `current_backend` from project settings; returns 400 if no engine is configured or the active engine does not support lore sync
  - **Yandex adapter**: uploads changed/new non-empty lore nodes as plain-text files to Yandex Files API; stores `file_id` in each node's `ai_sync_info.yandex`; deletes remote files for nodes that became empty (`word_count=0`) or are marked `to_be_deleted`; rebuilds the SearchIndex after every sync; stores the new `search_index_id` in `ai_config.yandex.search_index_id`
  - Returns a progress summary: `{ uploaded, deleted, unchanged, search_index_id }`
- Lore generation API (`POST /api/ai/generate-lore`):
  - Request body: `{ prompt: string, includeExistingLore?: boolean, model?: string, webSearch?: string }`
  - `webSearch` semantics differ by engine: for Yandex it is the context size (`'none'|'low'|'medium'|'high'`); for Grok any non-`'none'` value enables live search
  - Reads `current_backend` from settings; returns 400 if no engine configured
  - Reads `text_language` setting (fallback `'ru-RU'`) and includes it in the system prompt
  - Builds system prompt: "You are a creative writing assistant. Generate a lore item for a story. Write the result in Markdown format. Language: {text_language}. Respond with only the lore content — no explanations, no preamble."
  - If `includeExistingLore`, the backend chooses a lore-grounding strategy based on engine capabilities:
    - **KB attachment** (e.g. Yandex with `search_index_id`): attaches the vector store as a search tool so the model retrieves relevant context automatically
    - **File attachment fallback** (engine has uploaded files but no KB): collects all `ai_sync_info[engine].file_id` values from lore nodes and attaches them directly to the request (provider-specific format; implemented per engine as needed)
    - If neither is available the generation proceeds without lore context
  - **Yandex**: uses OpenAI-compatible Chat Completions API; `model` defaults to `gpt://{folderId}/yandexgpt/latest`
  - **Grok**: uses xAI Responses API (`POST /v1/responses`) in **streaming mode** via the OpenAI SDK `client.responses.create({ stream: true })`; accumulates `response.output_text.delta` events; logs reasoning summary and web search events to the console; `model` defaults to `'grok-3'`; file attachments use `{ type: 'input_file', file_id }` format; web search uses `tools: [{ type: 'web_search' }]`
  - Returns `{ content: string }` on success or `{ error: string }` with HTTP 500 on failure
- AI config (`GET /api/ai/config`) also returns `last_model` per engine (`null` if not set); the frontend saves the last-used model after a successful generation via `POST /api/ai/config` with `{ engine, fields: { last_model } }`
- Plan generation API (`POST /api/ai/generate-plan`):
  - Same structure as generate-lore; JSON schema returns `{ title: string, content: string }`
  - Supports `mode: 'generate' | 'improve'` and `baseContent` (for improve mode)
  - No `includeExistingLore` parameter
- Billing API (`GET /api/ai/billing`):
  - Reads Grok `management_key` and `team_id` from `ai_config.grok` in project settings
  - If not configured: returns `{ configured: false }`
  - If configured: calls `POST https://management-api.x.ai/v1/billing/teams/{team_id}/usage` for each of four periods (last 1h / 24h / 7d / 30d) using `{ start_time, end_time }` ISO 8601 range
  - Returns `{ configured: true, totals: { last_hour, last_24h, last_7d, last_30d } }` with raw xAI API responses per period, or `{ configured: true, error: string }` on API failure
- Generation endpoints (`/generate-lore`, `/generate-plan`, `/generate-plan-children`) include `cost_usd_ticks`, `tokens_input`, `tokens_output` in the SSE `done` event when available from the AI provider (Grok only; Yandex returns no cost data)
- Plan children generation API (`POST /api/ai/generate-plan-children`):
  - Request body: `{ prompt, parentTitle, parentContent, model?, webSearch? }`
  - System prompt instructs AI to create ~5–10 child items totalling ~5 000 words
  - JSON schema: `{ description: string, items: [{ name: string, description: string }] }`
  - Returns same SSE format as other generation endpoints
- Plan nodes CRUD API (`/api/plan/*`):
  - `GET /api/plan/nodes` — full tree (all columns including stats + review fields) — kept for backward compatibility
  - `GET /api/plan/nodes/:id` — single node with all fields
  - `POST /api/plan/nodes` — create node (legacy, uses parent_id)
  - `PATCH /api/plan/nodes/:id` — update title/content; supports `start_review`, `accept_review` flags (same semantics as lore PATCH); also supports new graph fields: `type`, `x`, `y`, `user_prompt`, `system_prompt`, `summary`, `auto_summary`
  - `DELETE /api/plan/nodes/:id` — hard delete (cascade)
- Plan graph CRUD API (`/api/plan/graph/*`):
  - `GET /api/plan/graph` — full graph: `{ nodes: PlanNodeRow[], edges: PlanEdgeRow[] }`
  - `POST /api/plan/graph/nodes` — create node; body: `{ type?, title, x?, y?, user_prompt?, system_prompt? }`
  - `GET /api/plan/graph/nodes/:id` — single node
  - `PATCH /api/plan/graph/nodes/:id` — update any writable fields; returns `{ ok, word_count?, char_count?, byte_count? }`
  - `DELETE /api/plan/graph/nodes/:id` — hard delete (cascade-deletes connected edges via FK)
  - `POST /api/plan/graph/edges` — create edge; body: `{ from_node_id, to_node_id, type?, position?, label?, template? }`
  - `PATCH /api/plan/graph/edges/:id` — update type/position/label/template
  - `DELETE /api/plan/graph/edges/:id`
- Root plan node auto-creation:
  - When a project is opened (`POST /api/project/open`) and `plan_nodes` is empty, a root node is automatically inserted with `title = project_title` (fallback: `'Plan'`)
  - When a project is created (`POST /api/project/create`), a root plan node is inserted with `title = name`
- Project creation (`POST /api/project/create`):
  - Accepts optional `text_language` field in request body (default `'ru-RU'`)
  - Stores `text_language` as a project setting alongside `project_title`

### Development Workflow
- `npm run dev` starts three processes concurrently via `concurrently`:
  1. Express backend with nodemon on port 3001 (system Node.js)
  2. Vite frontend dev server on port 3000 (proxies `/api` to port 3001)
  3. Electron, loading `http://localhost:3000` with DevTools open
- Before starting, `npm run dev` automatically rebuilds `better-sqlite3` for the system Node.js ABI (`predev` hook). This is necessary because `npm run package` (via electron-builder) compiles it for Electron's Node.js, which has a different ABI.
- `npm run package` rebuilds native modules for Electron automatically via electron-builder.

### Build Output
The build process (`npm run package`) produces platform-specific installers in `release/`:
- Windows: NSIS installer (`AI Story Builder Setup.exe`)
- Linux x64: AppImage (`AI Story Builder.AppImage`)
- macOS x64 + arm64: DMG (`AI Story Builder.dmg`)
