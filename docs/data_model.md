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
  - `current_backend` → "grok" | "yandex" | "local" | "mock:grok" | "mock:yandex"
  - `ai_config` → JSON with per-engine configuration
  - `save_api_keys` → "true" | "false"
  - `ui_layout` → JSON with saved dockable layout
  - `last_opened_at`, `project_title`, etc.

## Lore (Unified tree of nodes and persistent texts)
Lore is a unified tree of nodes. A node with children acts as a section/folder; a node with
versions holds content; a node may be both. There is no separate node type field — behaviour
emerges from usage.

- `lore_nodes`
  - `id` INTEGER PRIMARY KEY
  - `parent_id` INTEGER NULL REFERENCES `lore_nodes`(`id`) ON DELETE CASCADE
  - `name` TEXT NOT NULL
  - `position` INTEGER DEFAULT 0
  - `status` TEXT NOT NULL DEFAULT 'ACTIVE'   -- ACTIVE | TO_BE_DELETED
  - `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
  - Unique constraint on (`parent_id`, `name`)

- `lore_versions`
  - `id` INTEGER PRIMARY KEY
  - `lore_node_id` INTEGER NOT NULL REFERENCES `lore_nodes`(`id`) ON DELETE CASCADE
  - `version` INTEGER NOT NULL
  - `content` TEXT NOT NULL
  - `status` TEXT NOT NULL DEFAULT 'ACTIVE'   -- ACTIVE | TO_BE_DELETED | UPLOADED
  - `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
  - Unique constraint on (`lore_node_id`, `version`)

## Story Plan (hierarchical tree)
- `plan_nodes`
  - `id` INTEGER PRIMARY KEY
  - `parent_id` INTEGER NULL REFERENCES `plan_nodes`(`id`) ON DELETE CASCADE
  - `title` TEXT NOT NULL
  - `position` INTEGER DEFAULT 0
  - `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP

- `plan_node_versions`
  - `id` INTEGER PRIMARY KEY
  - `plan_node_id` INTEGER NOT NULL REFERENCES `plan_nodes`(`id`) ON DELETE CASCADE
  - `version` INTEGER NOT NULL
  - `instruction` TEXT NOT NULL
  - `result` TEXT
  - `status` TEXT NOT NULL DEFAULT 'DRAFT'   -- DRAFT | GENERATED | EDITED
  - `parent_version_id` INTEGER NULL REFERENCES `plan_node_versions`(`id`)
  - `is_obsolete` BOOLEAN DEFAULT FALSE
  - `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
  - Unique constraint on (`plan_node_id`, `version`)

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
- All versioned entities (`plan_node_versions`, `story_parts`, `card_values`) support tree-like history via `parent_version_id` and `is_obsolete` flag.
- Visual diff and version restore is possible for: plan node instructions, plan node result, story part instructions, story part result, and card actual values.
- When a story part is regenerated or edited, all dependent card versions after it are marked as obsolete.
- Schema version is tracked via `PRAGMA user_version` stored in the SQLite file header.

This data model fully supports all described use cases including dockable UI, multiple AI backends, version history with visual diff, lore synchronization per engine, and project-level settings.

Migrations
----------
- Migration logic lives in `src/backend/db/migrations.js` as an ordered array of functions (one per version step).
- Each migration function receives an open `better-sqlite3` Database instance and runs inside a transaction; `PRAGMA user_version` is updated atomically within the same transaction.
- A backup of the database file is created before migrations run (keep last 7 backups).
- When running the app, migrate the database to the latest version before opening the application data (mandatory to preserve schema compatibility).

