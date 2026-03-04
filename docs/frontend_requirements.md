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

### Additional Technical Requirements
* Centralized API client with easy backend switching (Grok / Yandex / Local / Mock)
* Comprehensive error boundaries
* Keyboard shortcuts support
* Accessibility (ARIA labels, keyboard navigation)
* Lazy loading for heavy panels and virtualization for long lists
