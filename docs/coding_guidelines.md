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

These guidelines are part of the project's acceptance criteria and should be reviewed when adding new features.