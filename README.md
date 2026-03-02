AI Story Builder

This project uses Tailwind CSS with a Shadcn/ui-inspired design system. Components follow Shadcn design principles and support dark/light theming. All user-facing text is stored in UTF-8 JSON files for internationalization.

A desktop-style menu bar has been added to the application.  The **View** menu exposes commands for resetting the dock layout to defaults and selecting the current color theme (zinc, slate, neutral, obsidian, carbon).  Theme choice persists between sessions.

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
