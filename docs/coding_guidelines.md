# Coding Guidelines

To keep the project maintainable and scalable, follow these rules:

* **Backend structure** – Organize server code by entity. Each major domain (projects, folders, lore, plan, generated parts, etc.) should live in its own subdirectory under `src/backend`.  
  Within each directory, put individual route handlers in separate files (e.g. `create.js`, `list.js`, `move.js`).  Import and assemble them in a central router.  Avoid a monolithic `projectRoutes.js` file.
* **Frontend structure** – Use a component-per-file approach and prefer functional components with hooks. Keep styling using Tailwind util classes or shadcn/ui patterns.
* **Theming & I18n** – All text strings are stored in UTF-8 JSON files under `src/frontend/src/i18n`.  Do not inline user-visible text.
* **URL routing** – UI must reflect application state in the URL (React Router is used).  Reloading the page should not reset to the start screen.
* **Styling** – Follow the design system (Shadcn/ui + Tailwind). Tree views, buttons, forms, and panels must look polished; do not leave plain black text on white.
* **Interactive docking** – Panels should be implemented with a docking/window library or custom drag/resize handlers. Users must be able to reposition and dock panels via drag‑drop.
* **Dependency management** – Frontend and backend must have separate `package.json` files to maintain clear separation of concerns. Dependencies should be installed only in the relevant workspace.

* **HTTP error codes** – Use the correct status code for each failure:
  * `400 Bad Request` – missing or invalid parameters supplied by the client.
  * `404 Not Found` – requested resource does not exist.
  * `409 Conflict` – the operation conflicts with the current state (e.g. duplicate name).
  * `500 Internal Server Error` – an unexpected server-side failure only (unhandled exception, I/O error, etc.).
  Returning `500` because of wrong UI state or invalid user input is a **bug** and must be fixed, not accepted.
* **Error logging** – The backend logs a stack trace for every 4xx/5xx response automatically. Never swallow exceptions silently; always surface them as the appropriate HTTP error code with a descriptive `{ error: "..." }` JSON body.

These guidelines are part of the project's acceptance criteria and should be reviewed when adding new features.