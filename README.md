AI Story Builder

AI Story Builder is a comprehensive tool for creative writing that helps authors organize their story elements, generate content with AI assistance, and maintain consistency across their narrative.

Key capabilities include:
* Project organization with folders for lore elements (locations, characters, etc.)
* Story planning with hierarchical tree structure and version-controlled nodes
* AI-assisted content generation for story parts with automatic card updates
* Integrated lore management with AI synchronization (Yandex Cloud AI, Grok API)
* Dockable UI panels for lore, plan, story editor, and cards
* Multi-language support (English/Russian) with UTF-8 JSON files
* Session-based project management with automatic backups
* Visual diff tools for tracking changes in story elements
* Theme customization with dark/light mode support

## Project Structure

This project now uses npm workspaces to separate frontend and backend dependencies:
- `src/frontend` - React frontend application
- `src/backend` - Node.js/TypeScript backend; logic in `routes/`, exposed via Electron IPC (no HTTP server)

## Dev:

### Application


```bash
npm install
npm run dev
```

This starts the Vite frontend dev server with hot reloading on http://localhost:3000 and builds the backend; Electron then launches and communicates with the backend via IPC (no separate backend port). For development, use the Electron window that opens.

## Build:

```bash
npm install
npm run build
npm run package
```

This builds the frontend and backend, then packages the Electron app. The packaged application is in `release/` (e.g. `AI Story Builder.AppImage` on Linux, `AI Story Builder Setup.exe` on Windows). Run the packaged app; it serves the built frontend and uses no separate server process.

## Package:

```bash
npm run package
