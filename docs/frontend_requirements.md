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

### LoreEditor Panel

A dockview panel (`id='lore-editor-{nodeId}'`) opened from the Lore Tree by double-clicking a node or via the "AI Wizard" wand button (which first creates a blank child node and then opens LoreEditor for it).

**Props:** `nodeId: number`, `panelApi?: { setTitle: (t: string) => void }`

**Two modes** (toggled within the panel, not separate panels):

#### Generate mode (default)

**Layout (flex-col, full height):**
- Prompt `<textarea>` (h-1/5) with placeholder "Describe what to generate…"
- Toolbar row:
  - "Include existing lore" checkbox (checked by default)
  - Web search control — depends on active engine's `webSearch` capability:
    - `'contextSize'` (Yandex): `<select>` with options none/low/medium/high
    - `'boolean'` (Grok): checkbox
  - Model `<select>` (shown when `available_models.length > 0`); restored to last-used model
  - **"Generate"** button (when content is empty) or **"Regenerate"** button (when content is present)
    - If the latest `lore_version` has `source='manual'` and content is non-empty: confirmation dialog warns that manual changes will be overwritten
- Name `<input>` (between controls and editor, with "Saving…"/"Saved" indicator)
- CodeMirror Markdown editor (flex-1)
- **"Improve with AI…"** button (bottom, shown only when content is non-empty and not generating)

#### Improve mode (entered by clicking "Improve with AI…")

**Layout (flex-col, full height):**
- Improvement instruction `<textarea>` (h-1/5), collapses to a single compact line during generation
- Same toolbar row (model, web search, "Include existing lore")
- **"Improve"** + **"Cancel"** buttons
- Name `<input>` + "Saving…"/"Saved" indicator
- CodeMirror Markdown editor (flex-1, new content streams in)

**Behaviour (both modes):**
- On mount: loads node via `GET /api/lore/:id`; fetches `GET /api/lore/:id/latest` to read the latest version's `source`; fetches `GET /api/ai/config` for engine/model
- **Generate/Regenerate**: `POST /api/ai/generate-lore` with `{ prompt, includeExistingLore, model?, webSearch?, mode: 'generate' }`; streams `partial_json` events to update name + content live; on done, saves via `PATCH /api/lore/:id` with `{ content, name?, source: 'ai', prompt, response_id }`
- **Improve**: same as Generate but with `{ mode: 'improve', baseContent: currentContent }`; backend uses different system prompt embedding the current text
- **Manual edits** (name or content): autosaved with 1 s debounce; content saves create a new `lore_versions` entry with `source='manual'`
- Persists selected model via `POST /api/ai/config` after each generation

**Wand button in LoreTree toolbar:**
- Shows `Wand2` icon; enabled only when exactly one node is selected and an AI engine is configured
- Action: `POST /api/lore` to create a blank child node, then opens `LoreEditor` for the new node

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
