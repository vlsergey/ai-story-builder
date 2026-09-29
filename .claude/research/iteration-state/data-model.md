# Iteration state — data model

*2026-09-29, revised after review. Part of the architecture proposal; see [README.md](README.md).*

## Two tables

`plan_nodes` keeps **definitions** only: `id`, `parent_id`, `title`, `type`,
`position`, `x`/`y`/`width`/`height`, `node_type_settings`, `ai_settings`,
`created_at`. Nothing in it changes when a node runs.

`plan_node_states` holds **all state**, root nodes included:

```sql
CREATE TABLE plan_node_states (
  node_id                INTEGER NOT NULL REFERENCES plan_nodes (id) ON DELETE CASCADE,
  path                   TEXT    NOT NULL,
  content                TEXT,
  summary                TEXT,
  status                 TEXT    NOT NULL DEFAULT 'EMPTY',
  word_count             INTEGER NOT NULL DEFAULT 0,
  char_count             INTEGER NOT NULL DEFAULT 0,
  byte_count             INTEGER NOT NULL DEFAULT 0,
  in_review              INTEGER NOT NULL DEFAULT 0,
  review_base_content    TEXT,
  ai_improve_instruction TEXT,
  rev                    TEXT    NOT NULL DEFAULT (lower(hex(randomblob(8)))),
  PRIMARY KEY (node_id, path)
);
CREATE INDEX idx_plan_node_states_path ON plan_node_states (path);
```

`ai_sync_info` does not move: nothing reads it for plan nodes. `rev` changes on
every write — see "Write ordering" in [engine.md](engine.md). Counts are
recomputed on **every** write, from the processor's output rather than the raw
content: fix-problems, split and container content is JSON. Today only `create`
computes them, from raw content.

## The path

```
path        := '' | segment ( '/' segment )*
segment     := containerId ':' iterationKey
containerId := decimal plan_nodes.id
iterationKey:= index     -- for-each: decimal, no leading zeros
             | hashKey   -- parallel-for-each: lowercase hex, >= 6 chars
```

- `''` is the root; `'27:2'` is a child of loop #27 in iteration 2;
  `'27:2/40:0'` is one level deeper. Depth = number of container ancestors; a
  non-container parent adds no segment.
- "At or below `A`" in SQL: `path = :a OR (path >= :a || '/' AND path < :a || '0')`
  — `'0'` is the character after `'/'`, so it uses the index and needs no LIKE.
  `A = ''` means no filter.
- Only a container builds its children's paths. Nothing else concatenates them.

## A missing row is not EMPTY

- **No row** = never produced. For processing it is *pending*: it makes
  consumers stale and makes its container need a visit, like an OUTDATED row.
- **An EMPTY row** = produced, and the answer is empty. A generative node's EMPTY
  is contagious (a retry may produce content); a deterministic node's EMPTY fed by
  settled inputs is not, and neither is the EMPTY of a node with nothing to
  generate from.
- **Every node type resolves pending.** A node the scheduler skips because it has
  nothing to generate from — a text node without a prompt, lore — writes a
  settled row: its content if it has one at that path, otherwise EMPTY. Today
  that skip writes nothing (`regenerateTreeNodesContents.ts:419-433`), which under
  this model would leave consumers stale forever. After a successful run no child
  of a visited container is missing or OUTDATED at a current key.
- The UI may *display* a missing row as empty; processing never treats it so.

This separates by data the two meanings EMPTY has carried until now — "not yet"
and "nothing" — which the forward-propagation fix of `accfede` had to separate by
node type instead.

## Iteration identity

- **`for-each`: the index.** A sequential loop needs the position anyway, and a
  changed earlier element invalidates everything after it regardless of identity.
- **`parallel-for-each`: a hash of the element.** SHA-256 of the element exactly
  as received (UTF-8), lowercase hex; the key is the shortest prefix of at least
  6 characters that tells the container's current distinct elements apart. It
  grows when that stops holding and never shrinks.
- **Identical elements are one iteration.** Same task; running it twice buys two
  random answers to one question. Its result fills every position the element
  occupies. So a parallel iteration may have several positions.
- **Growth renames rows.** When the key length grows, every row under the old
  segment — nested ones included — is renamed in one transaction, during the
  container's expansion, when none of its branches runs. To know which current
  element an old key belonged to once two share it, the container keeps each
  iteration's full hash.

## A container's own state

A container stores **no state of its children**. Its own row, at its own path:

| container | `content` |
|---|---|
| `for-each` | `{"length": n}` |
| `parallel-for-each` | `{"keyLength": 6, "iterations": {"a3f9c1": "<full sha-256>", …}}` |

Its output is computed from its output child's rows across its iterations and is
never stored. The container writes its `for-each-input` rows itself, one per
iteration, when it expands its input at the start of its run
([engine.md](engine.md)).

## Lifecycle

- Node deleted → its rows go by `ON DELETE CASCADE`.
- A container's input shrinks → its next run deletes the rows of vanished
  iterations and everything nested under them.
- A node moves to another container → its rows and its subtree's rows are
  deleted in the same transaction as the move; its paths no longer mean anything.
- Definition edits demote the node's rows at every path, MANUAL ones excepted
  ([cascade.md](cascade.md)).

## What counts as state

Content, summary, status, counts and the three review fields, per `(node, path)`.
Review becomes per iteration — today `in_review` and friends stay on the row
across page switches, so a review started on page 2 shows on page 3.
`ai_improve_instruction` is listed as state on the grounds that it belongs to one
improve session over one content; see the open question in [README.md](README.md).
