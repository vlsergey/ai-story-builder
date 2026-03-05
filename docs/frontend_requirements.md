## Frontend Architecture Requirements

### Tech Stack
* React 19 + Vite
* TypeScript (strict mode)
* Tailwind CSS + Shadcn/ui (primary component library)
* Dockable layout system: dockview (preferred)
* Global state: Zustand
* Server state & caching: TanStack Query (React Query)
* Forms: React Hook Form + Zod
* Markdown editor: CodeMirror 6 via `@uiw/react-codemirror` + `@codemirror/lang-markdown` (supports syntax highlighting, dark/light themes, word-wrap toggle)
* i18n: react-i18next (English + Russian minimum)
* Desktop shell: **Electron** (the app runs as an Electron desktop app). Electron is used for:
  * Native application menu (File / Edit / View / Window) with IPC bridge to the renderer
  * System integrations (opening external URLs in the system browser, window management)
  * IPC pattern: main process sends actions to renderer via `menu-action` channel; renderer syncs state back via `set-menu-state` channel
  * The `window.electronAPI` bridge is declared in `src/frontend/src/types/electron.d.ts`

### Core Architecture
* Desktop-first design (minimum supported width 1280px)
* Fully dockable, resizable and floating panel interface.  Panels should support drag‑drop docking, undocking and re‑positioning; the layout state is saved per project in the database.
* Tree views (folders, plan nodes) must render with clear visual hierarchy — icons, borders, indentation and hover effects — not plain text lists.
* Clear feature-based structure (/features, /components, /layouts, /stores)

### Theming & Internationalization
* Use Shadcn/ui + Tailwind CSS as the main design system.
* All components must follow Shadcn/ui design principles.
* Visual diff views should be clear and aesthetically pleasing (GitHub-style or similar).
* System theme (dark/light) by default with full light/dark mode support
* Support for multiple color palettes: Zinc (default), Slate, Neutral, Obsidian, Carbon
* Theme selection should be persistent across sessions
* All text content uses UTF-8
* Theme background must be consistent across all panels with no white borders around dark layouts when using dark theme
* Translations stored in separate JSON files

### Real-time State Propagation Between Panels

Since this is a **local, single-user Electron application**, the chosen pattern for propagating backend state changes to the frontend is **Frontend Event Bus via `CustomEvent` on `window`**.

**Rationale**: The frontend is always the initiator of saves; it already holds the new data and can compute derived stats (word/char/byte counts) locally. There is no need for Server-Sent Events or WebSockets for events the frontend itself triggers. SSE/WebSockets are reserved for changes that originate on the backend without frontend initiation (e.g., future AI-generation progress).

**Pattern**: After a successful backend save the initiating component dispatches a typed `CustomEvent` on `window`. Other components (e.g., the Lore Tree) subscribe to the event via `window.addEventListener` inside a `useEffect`, update their local state, and clean up on unmount.

All shared event names and detail types live in `src/frontend/src/lib/lore-events.ts`.

### LoreWizard Panel

A dockview panel (`id='lore-wizard-{nodeId}'`) opened from the Lore toolbar via a wand button when a node is selected and an AI engine is configured.

**Props:** `parentNodeId: number`, `parentNodeName: string`, `panelApi?: { setTitle: (t: string) => void }`

**Layout (flex-col, full height):**
- Prompt `<textarea>` (h-1/4) with placeholder text
- Toolbar row:
  - "Include existing lore" checkbox (always enabled, **checked by default**)
  - Web search control — depends on active engine's `webSearch` capability (from `BUILTIN_ENGINES`):
    - `'contextSize'` (Yandex): `<select>` with options none/low/medium/high
    - `'boolean'` (Grok): checkbox "Web search"
    - `'none'`: control not shown
  - Model `<select>` (shown when `available_models.length > 0`); restored to last-used model for the engine on load
  - "Generate" button; the backend decides how lore is grounded based on engine capabilities
- CodeMirror Markdown editor (flex-1) displaying and allowing editing of the AI response
- Footer row: name `<input>` + "Save" button

**Behaviour:**
- On mount: sets panel title to `'AI Wizard → {parentNodeName}'`; fetches `GET /api/ai/config` to determine active engine, available models, and last-used model (`last_model`); restores `last_model` if still in the available model list
- **Generate**: `POST /api/ai/generate-lore` with `{ prompt, includeExistingLore, model?, webSearch? }`; on success populates CodeMirror with `data.content` and persists selected model via `POST /api/ai/config`; shows inline error on failure
- **Save**: creates a new lore node via `POST /api/lore` (child of `parentNodeId`, with the given name), then saves content via `PATCH /api/lore/:id`; dispatches `LORE_TREE_REFRESH_EVENT` so the tree reloads

**Wand button in LoreTree toolbar:**
- Shows `Wand2` icon at the start of the toolbar (before the separator)
- Enabled only when exactly one node is selected **and** an AI engine is configured (`currentAiEngine != null`)
- Tooltip: `'Create with AI'` / `'Create with AI (no engine configured)'`

### New Project Form

The "Create new project" form on the Start Screen includes a language selector:
- `<select>` dropdown with options: `ru-RU` (Русский), `en-US` (English)
- Default: `ru-RU`
- Value is sent as `text_language` in the `POST /api/project/create` body

### Settings Panel

A singleton dockview panel (`id='settings'`) that opens in the editor group by default (same group as lore-editor tabs) via View > Settings. Can be moved freely and returned to the editor group.

**Content:**
- Current AI Engine selector (dropdown): `none` / `grok` / `yandex` / user-defined custom engines
  - Saving triggers `POST /api/ai/current-engine` with validation; inline error shown on rejection
  - On success: dispatches `AI_ENGINE_CHANGED_EVENT` on `window` so `LoreSettingsProvider` re-fetches
- Per-engine section (one for each configured engine):
  - Credential fields (auto-saved on blur; password fields with Show/Hide toggle)
  - **Test Connection** button → `POST /api/ai/:engine/test` with current form values → spinner → "✓ Connected (N models)" or "✗ Error message"
  - **Capabilities list**: File Upload, File Attachment, Knowledge Base, Knowledge Base Attachment — checkmark/cross per capability with description
  - **Age rating badge** (colored): G / PG / 12+ / 16+ / 18+ / NC-21
- **Model selection is NOT in engine config** — models are chosen per-operation

**AI Engine capability definitions** live in a shared frontend module (e.g., `src/frontend/src/lib/ai-engines.ts`) so they can be imported by both SettingsPanel and future panels.

### Additional Technical Requirements
* Centralized API client with easy backend switching (Grok / Yandex / Local / Mock)
* Comprehensive error boundaries
* Keyboard shortcuts support
* Accessibility (ARIA labels, keyboard navigation)
* Lazy loading for heavy panels and virtualization for long lists
