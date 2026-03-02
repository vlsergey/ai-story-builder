## Backend Tech Stack and Functional Requirements

### Tech Stack
- Runtime: Node.js 22 LTS (Active LTS)
- Language: TypeScript (strict mode)
- Framework: Express.js
- Database: SQLite 3 with better-sqlite3 driver
- Schema migrations: Liquibase
- HTTP Client: Axios
- Configuration: dotenv + Zod schema validation
- Logging: Pino
- Standalone packaging: 
  - Primary: Node.js SEA (Single Executable Application)
  - Fallback: vercel/pkg

### Functional Requirements (Architecture Level)
- The backend must run as a single executable file on target machines without requiring Node.js or any other dependencies to be installed.
- Must support three target platforms: Windows (x64), Linux (x64), and macOS (universal binary — x64 + arm64).

### Code Organization
- All API endpoints should be separated by domain/entity.  For example, routes pertaining to folders, lore, plans, versions, AI calls, etc. should live in their own directory under `src/backend` (e.g. `routes/folders.js`, `routes/lore.js`, etc.).
- Each individual endpoint implementation (e.g. `GET /folders/tree`, `POST /lore_items/:id/versions`) should reside in its own file or clearly named function to keep files small and maintainable.
- The backend project must be well‑organized overall; `server.js` should only wire middleware and import route modules, while business logic lives in separate route/handler files and utility modules.
- Shared utilities (database connection, settings, helpers) should be factored into reusable modules.
- The main `server.js` should mostly wire up middleware and import route modules rather than containing business logic.
- Each project is stored in its own SQLite database file (.db). The application works with only one open project at a time.
- Automatic database backup is created before opening any project and before schema migrations (keep last 7 backups).
- When the executable is launched, it should automatically start the internal web server and open the default browser pointing to the UI.
- Full support for multiple AI backends: Grok API, Yandex Cloud AI, Local LLM (via OpenAI-compatible HTTP endpoint), and Mock mode.

### Build Output
- The build process produces three separate executables:
  - ai-story-builder-win.exe (Windows)
  - ai-story-builder-linux (Linux x64)
  - ai-story-builder-macos (macOS universal)
- The executable must automatically start the web server and open the default browser pointing to the UI upon launch.
