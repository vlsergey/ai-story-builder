# AGENTS.md – Rules for Development Agents

This document contains rules that must be followed when developing in the AI Story Builder project. The goal is to ensure consistency, quality, and predictability of the codebase.

## 1. Core Principles

### 1.1. Read the docs first — always

**Before doing anything**, read the relevant files in `/docs/`. They are the authoritative source for architecture, data model, requirements, and coding conventions. Update them as part of every feature or fix.

Key files:
- `coding_guidelines.md` — code style, TypeScript build architecture, test conventions, CI pipeline
- `backend_requirements.md` — backend tech stack, API structure, AI engine architecture
- `frontend_requirements.md` — frontend tech stack, UI conventions
- `data_model.md` — database schema and entity relationships
- `use_cases.md` — product requirements and user scenarios

### 1.2. Non‑negotiable rules

#### Bug fixes
1. **Write a failing test first** that reproduces the issue.
2. **Fix the bug** in the code.
3. **Confirm the test passes**.

#### Database schema
All schema changes go through migrations in `src/backend/db/migrations.ts`. Never edit initial `CREATE TABLE` statements. Keep `setupDb()` fixtures in test files in sync with the real schema.

#### Git commits
- Run `npm test` (both workspaces) before every commit — **all tests must pass**.
- Never add AI co‑author lines to commit messages.
- Commit after every significant change before moving on.

## 2. Practical Guidelines

### 2.1. Developer platform check

Determine the developer's shell environment (Bash or PowerShell). Note that PowerShell lacks standard Unix commands (e.g., `head`, `tail`) and uses different syntax for command chaining: use `;` instead of `&&`. Ensure all generated commands are compatible with the detected shell.

### 2.2. Workspace commands

The project uses npm workspaces. To run commands in a specific workspace (backend or frontend), use:

```bash
npm run <script> --workspace src/backend
```
or
```bash
npm run <script> --workspace src/frontend
```

Do not change directories with `cd` — this ensures proper dependency resolution and environment.

## 3. References

- [Root README](../README.md) — general project description.
- [Documentation in /docs/](../docs/) — detailed guides.
- [CLAUDE.md](../CLAUDE.md) — instructions for Claude.

---
*This document should be clear to a development agent and serve as a quick reference when performing tasks.*
