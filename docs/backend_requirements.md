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
