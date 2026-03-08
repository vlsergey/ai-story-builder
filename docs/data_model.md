# Data Model

## Notes and high-level constraints
- One project = one SQLite database file. Each project stores a single work (no multi-work per DB).
- This application is local-only: there is no user authentication or multi-user support.
- Schema version is tracked via SQLite's built-in `PRAGMA user_version`. Migrations run automatically on database open.
- All layouts, UI settings and AI configuration are stored inside the project database.

## Database Compression
- When a new project database is created, page-level compression is **automatically enabled**.
- Algorithm: `zstd` (best compression ratio).
- This is done via `PRAGMA compression = 'zstd';` right after database creation.
- Purpose: significantly reduce database file size, especially for projects containing large amounts of Markdown text, JSON card data and generated chapters.
- Compression cannot be enabled on an existing database without recreating it (VACUUM INTO), therefore it is applied only at creation time.

## Data Storage Conventions
- All text data is stored in **UTF-8** encoding (SQLite default and enforced).
- All datetime fields are stored in **UTC**. If timezone information is required, it is stored as an offset.

## AI Configuration & Settings
- `settings` (key-value table for project-level configuration)
  - `key` TEXT PRIMARY KEY
  - `value` TEXT NOT NULL

Important keys:
  - `current_backend` → `"grok" | "yandex" | "local" | "mock:grok" | "mock:yandex" | null` — the active AI engine; null or missing means "none selected"
  - `ai_config` → JSON string with per-engine credentials (see structure below)
  - `save_api_keys` → `"true" | "false"`
  - `ui_layout` → JSON with saved dockable layout
  - `text_language` → `"ru-RU" | "en-US"` — language of story texts; used in AI generation system prompts; set at project creation (default `"ru-RU"`); backfilled to `"ru-RU"` for existing projects by migration 3 → 4
  - `last_opened_at`, `project_title`, etc.

### `ai_config` JSON structure
```json
{
  "grok": {
    "api_key": "xai-..."
  },
  "yandex": {
    "api_key": "AQVN...",
    "folder_id": "b1gXXXXXXXXXX",
    "search_index_id": "fvtXXXXXXXXXX"
  },
  "custom": {
    "{engine-id}": {
      "api_key": "...",
      "base_url": "http://..."
    }
  }
}
```

`search_index_id` (Yandex only): ID of the current SearchIndex containing all uploaded lore files. Stored here (not in lore nodes) because it is a project-level resource. Created/recreated by the sync operation. Since Yandex SearchIndex does not support removing individual files, the index is fully recreated on every sync that involves deletions.

**Note:** Model selection is NOT stored in the engine config. The specific model used for each operation (generation, plan, cards) is configured per-operation, not per-engine. This allows different operations to use different models on the same engine.

**Note:** API keys should only be stored in the project database when the user explicitly enables the "Save API keys" setting (disabled by default). When disabled, keys are kept only in memory for the session.

## Lore (Unified tree of nodes and persistent texts)
Lore is a unified tree of nodes. A node with children acts as a section/folder; a node with
versions holds content; a node may be both. There is no separate node type field — behaviour
emerges from usage.

- `lore_nodes`
  - `id` INTEGER PRIMARY KEY
  - `parent_id` INTEGER NULL REFERENCES `lore_nodes`(`id`) ON DELETE CASCADE
  - `name` TEXT NOT NULL
  - `content` TEXT — direct editable markdown text for the node (nullable; edited via the lore editor tab)
  - `word_count` INTEGER NOT NULL DEFAULT 0 — whitespace-separated word count of `content`; updated automatically by the PATCH endpoint whenever content changes; the tree view aggregates subtree totals from this field
  - `ai_sync_info` TEXT NULL — JSON object keyed by AI engine code (e.g. `"grok"`, `"yandex"`); each value is an `AiEngineSyncRecord` (see below); NULL means never synced with any engine
  - `position` INTEGER DEFAULT 0
  - `status` TEXT NOT NULL DEFAULT 'ACTIVE'   -- ACTIVE
  - `to_be_deleted` INTEGER NOT NULL DEFAULT 0   -- 1 = pending removal after next AI sync
  - `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
  - `changes_status` TEXT NULL — review workflow state: NULL (not in review) | `'review'` (AI improvement pending user acceptance)
  - `review_base_content` TEXT NULL — snapshot of `content` captured when the first AI improvement started; serves as the "old" side of diffs in review mode; set once per review session, never changed on repeat improvements, cleared on accept
  - `last_improve_instruction` TEXT NULL — last AI improve instruction used; stored when `start_review=true` so the review state (including prompt) can be restored when the editor is reopened; cleared on accept
  - `user_prompt` TEXT NULL — generation instruction stored per-node (autosaved)
  - `system_prompt` TEXT NULL — per-node system prompt override (autosaved)
  - Unique constraint on (`parent_id`, `name`)

`AiEngineSyncRecord` (value in `ai_sync_info` JSON map):
  - `last_synced_at` TEXT — ISO-8601 UTC timestamp of last successful sync
  - `file_id` TEXT (optional) — remote file ID if the node was uploaded as its own file to the AI engine
  - `uploaded_as_parent` boolean (optional) — true if the node's content was included in its parent's file rather than as a standalone file
  - `content_updated_at` TEXT (optional) — ISO-8601 UTC timestamp set by the PATCH endpoint each time content is saved; compared with `last_synced_at` to detect whether the node needs re-upload

## Story Plan (directed graph)

The plan is a directed graph. Nodes carry content and edges carry semantic roles. Edge direction A→B means "B uses output of A as context for generation".

- `plan_nodes`
  - `id` INTEGER PRIMARY KEY
  - `parent_id` INTEGER NULL REFERENCES `plan_nodes`(`id`) ON DELETE CASCADE — deprecated (kept for compatibility, superseded by `plan_edges`)
  - `title` TEXT NOT NULL
  - `content` TEXT — direct editable markdown text (nullable)
  - `type` TEXT NOT NULL DEFAULT `'text'` — `'text'` | `'lore'`
  - `x` REAL DEFAULT 0 — canvas X position
  - `y` REAL DEFAULT 0 — canvas Y position
  - `user_prompt` TEXT — generation instruction stored per-node (autosaved)
  - `system_prompt` TEXT — per-node system prompt override (autosaved)
  - `summary` TEXT — short auto-generated or manual summary
  - `auto_summary` INTEGER DEFAULT 0 — 1 = summary is auto-generated
  - `ai_sync_info` TEXT — reserved for future AI engine file sync (same format as `lore_nodes.ai_sync_info`)
  - `position` INTEGER DEFAULT 0 — deprecated; kept for migration purposes
  - `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
  - `word_count`, `char_count`, `byte_count` — updated automatically by PATCH
  - `changes_status` TEXT NULL — review workflow state: NULL | `'review'`
  - `review_base_content` TEXT NULL — snapshot before AI improvement
  - `last_improve_instruction` TEXT NULL — last AI improve instruction

- `plan_edges`
  - `id` INTEGER PRIMARY KEY
  - `from_node_id` INTEGER NOT NULL REFERENCES `plan_nodes`(`id`) ON DELETE CASCADE
  - `to_node_id` INTEGER NOT NULL REFERENCES `plan_nodes`(`id`) ON DELETE CASCADE
  - `type` TEXT NOT NULL DEFAULT `'instruction'` — `'instruction'` | `'attachment'` | `'system_prompt'`
  - `position` INTEGER DEFAULT 0 — display order among edges of the same target
  - `label` TEXT — optional display label override
  - `template` TEXT — optional template string (e.g. `{{title}}`) for rendering the source node as context

## Story Parts (generated chapters)
- `story_parts`
  - `id` INTEGER PRIMARY KEY
  - `plan_node_version_id` INTEGER NOT NULL REFERENCES `plan_node_versions`(`id`) ON DELETE CASCADE
  - `version` INTEGER NOT NULL
  - `content` TEXT NOT NULL
  - `status` TEXT NOT NULL DEFAULT 'GENERATED'   -- GENERATED | EDITED
  - `parent_version_id` INTEGER NULL REFERENCES `story_parts`(`id`)
  - `is_obsolete` BOOLEAN DEFAULT FALSE
  - `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
  - Unique constraint on (`plan_node_version_id`, `version`)

## Story Cards
- `card_definitions`
  - `id` INTEGER PRIMARY KEY
  - `name` TEXT NOT NULL
  - `definition` TEXT NOT NULL           -- free text describing card structure
  - `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP

- `card_values`
  - `id` INTEGER PRIMARY KEY
  - `card_definition_id` INTEGER NOT NULL REFERENCES `card_definitions`(`id`) ON DELETE CASCADE
  - `story_part_id` INTEGER NOT NULL REFERENCES `story_parts`(`id`) ON DELETE CASCADE
  - `version` INTEGER NOT NULL
  - `values` JSON NOT NULL               -- actual filled card data
  - `parent_version_id` INTEGER NULL REFERENCES `card_values`(`id`)
  - `is_obsolete` BOOLEAN DEFAULT FALSE
  - `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
  - Unique constraint on (`card_definition_id`, `story_part_id`, `version`)

## AI Interaction Log
- `ai_calls`
  - `id` INTEGER PRIMARY KEY
  - `backend` TEXT NOT NULL
  - `model` TEXT NOT NULL
  - `request_type` TEXT
  - `prompt` TEXT
  - `response_summary` TEXT
  - `tokens_input` INTEGER
  - `tokens_output` INTEGER
  - `cost` REAL
  - `related_story_part_id` INTEGER NULL REFERENCES `story_parts`(`id`)
  - `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP

## Design considerations
- Versioned entities (`story_parts`, `card_values`) support tree-like history via `parent_version_id` and `is_obsolete` flag.
- Visual diff and version restore is possible for: story part content and card actual values.
- When a story part is regenerated or edited, all dependent card versions after it are marked as obsolete.
- Lore node review workflow uses `changes_status`, `review_base_content`, and `last_improve_instruction` directly on `lore_nodes` to track in-progress AI improvements.
- Schema version is tracked via `PRAGMA user_version` stored in the SQLite file header.

This data model fully supports all described use cases including dockable UI, multiple AI backends, version history with visual diff, lore synchronization per engine, and project-level settings.

Migrations
----------
- Migration logic lives in `src/backend/db/migrations.js` as an ordered array of functions (one per version step).
- Each migration function receives an open `better-sqlite3` Database instance and runs inside a transaction; `PRAGMA user_version` is updated atomically within the same transaction.
- A backup of the database file is created before migrations run (keep last 7 backups).
- When running the app, migrate the database to the latest version before opening the application data (mandatory to preserve schema compatibility).

