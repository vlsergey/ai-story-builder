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

**Four modes** (4-state machine, animated transitions via `grid-template-rows` / `max-height`):

| Mode | Code | Open condition |
|------|------|----------------|
| A – Generate | `'generate'` | `changes_status IS NULL` + empty content |
| B – Edit + initiate improvement | `'edit'` | `changes_status IS NULL` + non-empty content |
| C – AI streaming (locked) | `'review_locked'` | Entered programmatically during improvement |
| D – Review diff (unlocked) | `'review_unlocked'` | After AI completes; or on open when `changes_status='review'` |

**Mode transitions:**
- `A → B`: clicking "Improve with AI…" button (bottom, only when hasContent)
- `B → C`: clicking "Improve" in the improve form (force-flush save, stream AI)
- `C → D`: AI streaming completes, result saved with `start_review=true` PATCH
- `D → C`: clicking "Repeat improvement" in compact instruction bar
- `D → B`: clicking "Accept changes", or auto-accept when all hunks resolved in per-lines diff

**Layout (flex-col, full height) — all sections always in DOM, animated via CSS transitions:**

```
[A] GENERATE CONTROLS  (grid 1fr↔0fr, mode A only)
    prompt textarea + aiControls row + Generate button

[C/D] COMPACT INSTRUCTION BAR  (grid 1fr↔0fr, modes C/D)
    instruction input + Repeat/Generating… button
    aiControls row

STATUS ROWS  (always visible when active)
    thinking spinner/checkmark + error message

NAME FIELD  (always visible)
    name input + Saving…/Saved indicator

[C/D] TAB BAR  (grid 1fr↔0fr, modes C/D; tabs disabled in C)
    "New version" | "Side by side" | "Per lines"

CONTENT AREA  (flex-1)
    A/B: CodeMirror (editable)
    C/D tab "new": CodeMirror (read-only in C, editable in D)
    C/D tab "side": DiffViewAndAccept split (read-only)
    C/D tab "lines": DiffViewAndAccept unified (hunk accept/reject)

[A→B] УЛУЧШИТЬ BUTTON  (max-height 52px↔0px, mode A + hasContent)

[B] IMPROVE FORM  (max-height 50vh↔0px, mode B)
    instruction textarea + aiControls + Cancel + Improve buttons

[D] ACCEPT BAR  (grid 1fr↔0fr, mode D)
    "Accept changes" button
```

**DiffViewAndAccept component** (`src/frontend/src/components/DiffViewAndAccept.tsx`):
- Props: `oldText`, `newText`, `viewType: 'split'|'unified'`, `onChange?`, `onAllResolved?`
- Split view: side-by-side two-column layout; left = old with removed lines (red), right = new with added lines (green); read-only
- Unified view: hunks with per-hunk Accept/Reject buttons; context lines shown between hunks; recomputes result content on each decision; calls `onAllResolved` when all hunks decided
- Uses `diff.diffLines` from the `diff` npm package (already a dependency)

**Behaviour:**
- On mount: loads node via `GET /api/lore/:id` (including `changes_status`, `review_base_content`); fetches `GET /api/lore/:id/latest` for `source` and `prompt`; fetches `GET /api/ai/config` for engine/model
- **Generate** (mode A): streams AI with `mode:'generate'`; on done, saves via `PATCH` with `source:'ai'`; transitions to mode B
- **Improve** (mode B→C): force-flush pending saves; capture content as `reviewBaseContent`; stream AI with `mode:'improve', baseContent:reviewBaseContent`; on done, `PATCH { start_review: true, source: 'ai', prompt, content }` — backend atomically saves old content as `review_base_content`, sets `changes_status='review'`, creates version; transitions to mode D
- **Repeat improvement** (mode D→C): same stream but `baseContent = reviewBaseContent` (unchanged original); no `start_review` in PATCH (review already active, baseline preserved); transitions back to D
- **Mode D auto-save** (new-version tab, 1 s debounce): `PATCH { content, source:'manual', skip_version: true }` — updates content without creating a version
- **Accept changes** (mode D→B): `PATCH { accept_review: true, content }` — backend clears `changes_status`/`review_base_content`; if content differs from latest version, creates new `'manual'` version; transitions to mode B
- **Manual edits** (name or content in modes A/B): autosaved with 1 s debounce; content saves create a new `lore_versions` entry with `source='manual'`
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

### PlanGraph Panel

A permanent dockview panel (`id='plan-graph'`) in the center area. Rendered by `PlanGraph.tsx` using **React Flow** (`@xyflow/react`) and **Dagre** (`@dagrejs/dagre`) for auto-layout.

**Toolbar (floating, top-left):**
- **Add text node** — prompts for title, `POST /api/plan/graph/nodes` with `type:'text'`
- **Add lore node** — same with `type:'lore'`
- **Auto layout** toggle (persisted in `localStorage`): when on, positions are recalculated with Dagre (LR direction) after any add; when off, nodes are freely draggable
- **Apply layout** button (only visible when auto=off): runs Dagre once and persists positions
- **Generate all** button — opens `GenerateAllDialog`

**Canvas interactions:**
- Double-click on text node → dispatches `OPEN_PLAN_NODE_EDITOR_EVENT` → `Layout.tsx` opens `plan-node-editor-{id}` panel
- Drag node (auto=off) → `PATCH /api/plan/graph/nodes/:id` with new `{x, y}`
- Connect two nodes → creates edge with type 'text' → `POST /api/plan/graph/edges`
- Hover over edge → shows Delete (×) button
- Edge color: text=blue (all edges are of type 'text')

**Custom node types:**
- `PlanTextNode` (`planText`): shows title, status badge (not generated / generated / review), word count, summary snippet
- `PlanLoreNode` (`planLore`): shows lore icon + title

**Custom edge type:** `PlanEdge` — smoothstep path, colored by type, animated label, hover delete

**Auto-layout algorithm:** Dagre with `rankdir: 'LR'`, `nodesep: 60`, `ranksep: 120`, node size 200×80

**Data fetching:** `GET /api/plan/graph` on mount and on `PLAN_GRAPH_REFRESH_EVENT`

### PlanEditor Panel (plan-node-editor)

A dockview panel (`id='plan-node-editor-{nodeId}'`) with the same 4-mode flow as LoreEditor. Opened from PlanGraph by double-clicking a text node.

**Props:** `nodeId: number`, `panelApi?: { setTitle: (t: string) => void }`

**Differences from LoreEditor:**
- Title field instead of name field (uses `plan_nodes.title`)
- Calls `/api/plan/nodes/:id` for GET/PATCH (also `/api/plan/graph/nodes/:id` for new fields)
- Uses `POST /api/ai/generate-plan` for AI generation
- Dispatches `PLAN_NODE_SAVED_EVENT` / `PLAN_GRAPH_REFRESH_EVENT`
- Shows **User Prompt** textarea (autosaved to `user_prompt`) and collapsible **System Prompt** textarea (autosaved to `system_prompt`) above the title field

**Four modes** (identical state machine to LoreEditor):
- A (generate): prompt textarea + AI controls + Generate button
- B (edit + improve): CodeMirror + improve form
- C (review_locked): streaming AI, UI locked
- D (review_unlocked): DiffViewAndAccept tabs, Accept bar

### Plan Events

Shared event constants and dispatch helpers:

`src/frontend/src/lib/plan-events.ts`:
- `PLAN_NODE_SAVED_EVENT` / `dispatchPlanNodeSaved({ id, title?, wordCount?, charCount?, byteCount? })`

`src/frontend/src/lib/plan-graph-events.ts`:
- `PLAN_GRAPH_REFRESH_EVENT` / `dispatchPlanGraphRefresh()` — triggers full graph reload
- `OPEN_PLAN_NODE_EDITOR_EVENT` / `dispatchOpenPlanNodeEditor(nodeId)` — triggers opening the node editor panel

### AI Billing Panel

A non-draggable dockview panel (`id='billing-panel'`) positioned below the Cards panel on the right side. Cannot be moved to the editor group (same restriction as lore/plan/cards panels).

**Default position:** below `cards-panel` in the right group.

**Sections:**
1. **Last request** — shows cost in USD, input/output token counts, and time-ago for the most recent AI generation in the current session. Data arrives via `AI_CALL_COMPLETED_EVENT` dispatched from `NodeEditor` after each generation/improve call.
2. **Period statistics** — shows per-period totals (last hour / 24h / 7d / 30d) including call count and total cost. Sourced from the xAI Management API (`POST https://management-api.x.ai/v1/billing/teams/{team_id}/usage`). Requires `management_key` and `team_id` to be set in Grok settings. Polled every 60 seconds; also refreshed immediately on `AI_CALL_COMPLETED_EVENT`.
3. **Refresh button** — manually triggers re-fetch.

**Cost display:** 1 tick = 1×10⁻¹⁰ USD. Values displayed as `$0.00XXX` with adaptive precision.

**Events:** `AI_CALL_COMPLETED_EVENT` (`ai-call-completed`) dispatched by `NodeEditor` with `{ costUsdTicks?, tokensInput?, tokensOutput? }` detail. Defined in `src/frontend/src/lib/billing-events.ts`.

**Not configured state:** if `management_key` / `team_id` not set in Grok settings, the period statistics section shows a prompt to configure them.

### Possible Future Features

- Per-item diff view for plan children generation — compare proposed vs existing child list item-by-item (non-trivial to implement)

### Additional Technical Requirements
* Centralized API client with easy backend switching (Grok / Yandex / Local / Mock)
* Comprehensive error boundaries
* Keyboard shortcuts support
* Accessibility (ARIA labels, keyboard navigation)
* Lazy loading for heavy panels and virtualization for long lists
