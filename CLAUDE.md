# Project Rules

## Read the docs first — always

**Before doing anything**, read the relevant files in `/docs/`. They are the authoritative source for architecture, data model, requirements, and coding conventions. Update them as part of every feature or fix.

Key files:
- `coding_guidelines.md` — code style, TypeScript build architecture, test conventions, CI pipeline
- `backend_requirements.md` — backend tech stack, API structure, AI engine architecture
- `frontend_requirements.md` — frontend tech stack, UI conventions
- `data_model.md` — database schema and entity relationships
- `use_cases.md` — product requirements and user scenarios

## Non-negotiable rules

**Bug fixes:**
1. Write a failing test first.
2. Fix the bug.
3. Confirm the test passes.

**Database schema:** All changes go through migrations in `src/backend/db/migrations.ts`. Never edit initial `CREATE TABLE` statements. Keep `setupDb()` fixtures in test files in sync with the real schema.

**Git commits:**
- Run `npm test` (both workspaces) before every commit — all tests must pass.
- Never add AI co-author lines to commit messages.
- Commit after every significant change before moving on.
