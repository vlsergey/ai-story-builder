# Project Rules

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

## Practical Guidelines

### Developer platform check

Determine the developer's shell environment (Bash or PowerShell). Note that PowerShell lacks standard Unix commands (e.g., `head`, `tail`) and uses different syntax for command chaining: use `;` instead of `&&`. Ensure all generated commands are compatible with the detected shell.

### Workspace commands

The project uses npm workspaces. To run commands in a specific workspace (backend or frontend), use:

```bash
npm run <script> --workspace src/backend
```
or
```bash
npm run <script> --workspace src/frontend
```

Do not change directories with `cd` — this ensures proper dependency resolution and environment.

### Architecture research notes

When investigating the codebase produces findings worth keeping across sessions (module maps, data-flow traces, refactor plans, design decisions), persist them as Markdown files under `.claude/research/`. One topic per file, descriptive kebab-case names (e.g. `template-export-format.md`, `plan-graph-execution.md`).

Rules for these notes:
- **English only** — language of the codebase, regardless of the conversation language.
- **Keep them tight** — aim for under ~150 lines per file. These notes are meant to save reading time on later sessions; if a note is so long it costs more to read than the code it summarizes, split it or trim it. Favor file:line pointers and surprising facts over restating code.
- Include file paths with line numbers when referencing code, so notes stay navigable.
- Date stamp each note and re-verify before relying on it — the code drifts faster than the notes.
- Update or delete a note when its content becomes stale; do not let outdated notes accumulate.

## References

- [Root README](README.md) — general project description.

---
*This document should be clear to a development agent and serve as a quick reference when performing tasks.*
