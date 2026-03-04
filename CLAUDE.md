# Project Rules

## Documentation

- All documentation must be written and maintained in **English**.
- The `/docs/` folder contains the authoritative project documentation:
  - `backend_requirements.md`
  - `frontend_requirements.md`
  - `use_cases.md`
  - `data_model.md`
  - `coding_guidelines.md`

## Workflow

- **Always read `/docs/` first** when starting any task. The docs folder is the authoritative description of the project architecture, data model, and requirements. Read and update the relevant doc files as part of every feature or fix.
- Before adding new functionality (not bug fixes), update the relevant requirements documents in `/docs/`, including the feature/capabilities list.
- When fixing a bug, follow this order:
  1. Write a failing test that reproduces the bug.
  2. Fix the bug.
  3. Confirm the test now passes.

## Database Schema

- **All schema changes must go through migrations.** Never edit the initial `CREATE TABLE` statements. Add a new migration step to `src/backend/db/migrations.ts` for every column/table addition or change.
- Each migration must backfill existing rows where possible (derive values from existing data).
- Test DB fixtures (`setupDb()` functions in `*.test.ts`) must be kept in sync with the real schema — add any new columns to the fixture `CREATE TABLE` statements.

## Git Commits

- Never add AI name (e.g. "Co-Authored-By: Claude") to commit messages or descriptions.
- Before every commit, run the full test suite for both workspaces and ensure all tests pass:
  - `npm run test --workspace=src/backend`
  - `npm run test --workspace=src/frontend`
- After any significant change (new feature, bug fix, refactor, doc update), create a git commit before moving on.
