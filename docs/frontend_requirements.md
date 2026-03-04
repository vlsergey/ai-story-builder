## Frontend Architecture Requirements

### Tech Stack
* React 19 + Vite
* TypeScript (strict mode)
* Tailwind CSS + Shadcn/ui (primary component library)
* Dockable layout system: dockview (preferred)
* Global state: Zustand
* Server state & caching: TanStack Query (React Query)
* Forms: React Hook Form + Zod
* Markdown editor: CodeMirror 6 via `@uiw/react-codemirror` + `@codemirror/lang-markdown` (supports syntax highlighting, dark/light themes)
* i18n: react-i18next (English + Russian minimum)

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

### Additional Technical Requirements
* Centralized API client with easy backend switching (Grok / Yandex / Local / Mock)
* Comprehensive error boundaries
* Keyboard shortcuts support
* Accessibility (ARIA labels, keyboard navigation)
* Lazy loading for heavy panels and virtualization for long lists
