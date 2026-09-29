# Iteration state — migration

*2026-09-29, revised after review. Part of the architecture proposal; see [README.md](README.md).
Facts about local data come from nine project DBs opened read-only: all at
`user_version` 31, 18 `for-each` containers, none nested.*

## The source of truth for the mounted page is the rows

For page `m = currentIndex ?? 0`, the live child rows win over `overrides[m]`.
`changeForEachNodePage` refreshes the snapshot only on a page switch;
propagation reads the rows. In the local data **7 of 18 containers disagree**, in
both directions — in one, the snapshot has 10 children OUTDATED while the rows
are GENERATED with different content. Taking the snapshot would throw generated
work away. One reader differs: `getOutput` compares strictly with `currentIndex`,
so while it is unset — after an input change, which never sets it — it takes
iteration 0 from the snapshot. The migration follows the other readers, and the
oracle names this case.

## Migration 033

One step, one transaction, raw SQL only (repositories use the global connection,
not the migration's), frozen — no runtime imports. It never aborts on data it
does not like: a throw rolls the transaction back and the project would not open.
Anomalies are WARNings naming the project and node.

1. Return early if `plan_node_states` exists and `plan_nodes` has no `content`.
2. Create `plan_node_states` and its path index ([data-model.md](data-model.md)).
3. Walk from the roots carrying `(path, view)`, where view is LIVE or a snapshot:
   - a root node gets its row at `''` from its own columns; a node whose parent
     does not exist is treated as a root, with a WARN;
   - a non-container parent passes its path and view to its children unchanged;
   - for a `for-each`, parse its content leniently (malformed → WARN, zero
     iterations); `L = length ?? overrides.length`;
   - child path `P/<id>:i` for `i < L`; view is LIVE only if the parent's view is
     LIVE and `i = m`, else `overrides[i]`;
   - snapshot defaults mirror `applyForEachNodeIterationToChildren`: a missing
     entry or null slot → content NULL, OUTDATED; missing status → EMPTY;
     counts recomputed from the output;
   - GENERATING, in rows or snapshots, becomes OUTDATED: a run was interrupted;
   - nested loops: an inner container's content is a JSON *string* inside the
     outer snapshot — parse twice. Only direct children were ever snapshotted and
     `onChildDemoted` mirrored one level, so demote any nested GENERATED row whose
     container is OUTDATED at that path. Nested recovery is best effort by
     necessity; no local project nests.
   - the container's own row gets `{"length": L}`.
4. Drop, with a WARN, snapshots **and live rows** at an index `≥ L` — live rows
   at `m ≥ L` would fail the invariants and be deleted by the first run anyway.
   **This changes a result**: one local project has 25 snapshots against `length`
   24, and the extra one — a 10,379-character GENERATED output — reaches a
   downstream merge today, because `getOutput` maps over `overrides`, not
   `length`. When a dropped entry carried output, the container and its direct
   consumers are set OUTDATED; otherwise the merge would keep the phantom as
   GENERATED.
5. Review fields: root nodes keep theirs. On loop children they are cleared with
   a WARN: they are not snapshotted, so they may belong to an iteration other than
   the mounted one, and "reject" would restore another iteration's text.
6. Check that every node outside a loop has exactly one `''` row — WARN, not
   assert.
7. `DROP COLUMN` the state columns from `plan_nodes`, and `ai_sync_info`. The
   bundled SQLite is 3.53.1; `DROP COLUMN` needs 3.35 and migrations 014, 020,
   022 and 028 already use it. No index, trigger or view references them.
8. Detect edges of the shapes now rejected (inside → outside, across sibling
   loops) and WARN; the engine refuses to resolve them at run time with a message
   naming both nodes. None exist in the fiction-arc templates.

Register as 033, bump `CURRENT_VERSION`, regenerate `schema.sql`.

## Around the migration

- **Pinned backup.** A backup is taken on every open and only seven are kept, so
  the pre-migration copy rotates out after seven more opens. When
  `fromVersion < CURRENT_VERSION`, also write a version-tagged copy under a name
  outside the rotation's `{basename}.*.bak` pattern (`db/backup.ts:44`), which
  would otherwise prune it.
- **Downgrade guard.** Today an older build opens a newer file without a word —
  the migration loop simply does not run (`migrations.ts:152`) — and then fails
  with "no such column". Refuse `fromVersion > CURRENT_VERSION` with a clear
  message, shipped in a release **before** 033 (phase 0 #17): the build users roll
  back to is the one that must refuse.
- **Scripts migrate before use.** None of them do today (`dump-node`,
  `switch-foreach-iteration`, `regenerate-node`, `update-project-from-template`,
  `export-ready-chunks`, `export-project-to-md` all open without migrating), and
  the `createProject` reuse branch skips migration too. New code would fail on a
  v32 file. One shared opener that backs up and migrates.
- **One release.** The code and 033 ship together.

## Testing

- `migrateDatabase(db, { toVersion })`, keeping `migrateDatabase(db, true)`
  working (tests 027–032, `generate-schema.ts:81`), so a test builds a v32 DB by
  running the chain, seeds it with raw SQL and applies 033. Reverting nine
  columns and a table by hand is unwieldy, and the full-chain pattern is what
  breaks the 027/028 tests once `plan_nodes.status` is gone.
- Cases: root-only DB; rows beating a stale snapshot, both directions; missing
  entries, null slots, missing status; `currentIndex` unset; `L = 0`; snapshots
  and live rows beyond `length`, and the phantom output demoting its consumers;
  GENERATING rows and snapshots; a non-container parent; an orphan; nested loops
  with doubly-encoded JSON; review fields kept at the root and cleared on loop
  children; malformed JSON; the early-return guard; FK cascade on delete; the
  dropped columns gone; `checkStateInvariants` on every result.
- **Equivalence oracle.** A frozen copy of the old read logic — rows for `m`,
  snapshots for the rest, `i < L` — compared against the new state rows for every
  node and iteration; root state unchanged.
- **Dry run on copies of the local DBs**, reporting per project what moved, what
  was dropped and every WARN.
- **Schema drift.** The existing schema test is tautological: `migrateDatabase` on
  a fresh DB loads `schema.sql` itself, so nothing checks that the chain produces
  `schema.sql`. Replace it with a structural comparison — `table_info`,
  `index_list`, `foreign_key_list` — of a chain-built DB against a
  `schema.sql`-built one. `generate-schema` expects prettier, which is not
  installed; fix that or drop the formatting step.

## Templates and scripts

- **Apply** writes initial state for every template node outside loops. Content
  on a loop child has no path at apply time — reject it in the template checks;
  no shipped template has it.
- **Update** demotes the rows of a changed node at every path (MANUAL excepted);
  new nodes simply get no row. **Export** reads definitions only.
- **Changing a node's type is impossible today** — nodes match by title and type
  is never compared. `for-each` → `parallel-for-each` for existing projects needs
  a retype category with an allow-list, a rule for the children the parallel
  container forbids, re-keying `P/C:i` → hash keys in one transaction, and a type
  write with its event. Or a one-off migration — see [plan.md](plan.md).
- **Scripts:** `switch-foreach-iteration` is obsolete — it becomes `--path` on
  `regenerate-node`; `dump-node`, `export-ready-chunks` and
  `export-project-to-md` read `plan_nodes.content` in raw SQL and are rewritten;
  `aggregate-telemetry` keys visits on the path.
