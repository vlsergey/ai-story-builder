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
- `src/backend` - Express.js backend server

## Dev:

### Application

The top‑level menu bar provides quick access to global actions:

* **View ▶ Reset layouts** – restore the default panel arrangement
* **View ▶ [theme name]** – choose one of the supported color palettes


```bash
npm install
npm run dev
```

This will start two servers:
- Frontend development server with hot reloading on http://localhost:3000
- Backend API server on http://localhost:3001

For development with hot reloading, access http://localhost:3000.

## Build:

```bash
npm install
npm run build
npm start
```

This will start the backend server which serves the built frontend files at http://localhost:3000.

## Package (requires `pkg`):

```bash
npm run package
