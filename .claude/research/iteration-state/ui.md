# Iteration state — UI

*2026-09-29, revised after review. Part of the architecture proposal; see [README.md](README.md).*

## The rule

**What the UI shows is not what processors process.** Processing state is per
`(node, path)` and lives in `plan_node_states`. Display state is derived per view
and is never written as node data. Today they are the same rows: the mounted page
is both what the user sees and what `propagateStaleStatus` reads, so the page
someone has open decides whether a container looks stale to the scheduler.

## Choosing an iteration is view state

- `IterationSelectionProvider`, client side, mounted next to
  `EditorSettingsProvider` (`Layout.tsx`) so the graph and editor panels share it.
- Keyed by **container and the container's own path**, so an inner loop remembers
  its page per outer iteration (today that memory exists only as a side effect of
  snapshots).
- Valued by the iteration's **identity**: its index in a `for-each`, its full hash
  in a `parallel-for-each` — not the short key, which is renamed when it grows,
  and not the position, which shifts when an element is inserted upstream. When
  the element is gone the selection falls back to the nearest position.
- Changing it writes nothing and works while the container is generating. The
  `forEachNodes.changePage` mutation goes away.
- **Follow the running iteration unless pinned.** In a sequential loop the pager
  follows the iteration being generated until the user picks one — today that
  happens implicitly, because the processor mounts each iteration. A parallel
  container runs several at once: its pager marks every running iteration and
  stays put.

## Fetching

- `plan.nodes.findAll` returns **definitions only**. Today it is `SELECT *`, so
  every event refetches every node's content, container blobs of up to 3.7 MB
  included.
- `plan.nodes.findStatesAtPath(path)` returns light state — status, summary,
  counts, no content — for the nodes at exactly that path: one query per displayed
  container path, shared by its children through the query key.
- React Flow keeps **one node per definition**, never one per iteration. Its node
  data is the definition; `SimpleNode`/`GroupNode` read display state through a
  hook, so switching iterations does not rebuild the node array.
- Editors fetch the composed row: `plan.nodes.getById({id, path})`.

## A container's displayed status

`plan.nodes.iterationStatuses({containerId, path})` returns the ordered iteration
identities and per-iteration status counts — one query over the container's
subtree at `path` — **including missing rows**: expected is children × current
keys, so a loop child just added by a template update does not show as settled. A
precedence function in `src/shared/plan-graph.ts` rolls them up: any running →
running, any error → error, any stale or missing → stale, all settled → generated,
with counts such as "3/4 generated, 1 running". Kept in shared so it is
display-only and tested once; the pager reuses the per-iteration statuses as page
markers. It must not read EMPTY as stale: EMPTY is an answer — a merge over no
previous outputs is EMPTY on iteration 0 — and a loop would never look finished.

Computed on the backend because the client would otherwise need every iteration's
full state to paint one badge.

## Events

- Node events carry `{nodeId, path, kind: "definition" | "state"}` instead of a
  bare id. A definition event invalidates `findAll` and `getById({id})`; a state
  event invalidates `findStatesAtPath(path)`, `getById({id, path})` and
  `iterationStatuses` for each container segment of the path. Renaming or
  deleting iterations emits a state event for the container's path. Today every
  event invalidates every node query and rebuilds the whole graph.
- Stream events gain `path`: `[nodeId, path, contentPath, event]`. `contentPath`
  stays — it is a position inside the content and carries fix-problems' own
  attempt index (off by one for the fix stream; harmless while nothing maps the
  label to an attempt, phase 0 #15). Buffers in
  `ResponseStreamWatcher`, `TextNodeEditor` and `AiThinkingPanel` are keyed by
  `(nodeId, path)`; today two iterations of one node would be glued into one
  buffer.

## Editing a node in an iteration

- An editor panel is bound to `(id, path)` when it opens: panel id
  `plan-node-editor-${id}@${path}`, iteration shown in the tab title. A saved
  layout with only `{nodeId}` (`Layout.tsx:106-118`) opens at the iteration
  currently selected for the node's containers.
- Two groups, labelled visibly: **content, summary, review** go to the state at
  `(id, path)`; **title, prompts, settings** go to the definition and apply to
  every iteration ([cascade.md](cascade.md) says which rows they demote).
- The editor adopts server state whenever it holds no unsaved edits and locks
  content while its path is GENERATING. It saves with the `rev` it loaded: a
  newer write in between gives a conflict prompt, not a silent overwrite. When
  its iteration vanishes, the panel says so and stops saving. Today the editor
  re-syncs only after its own generate or improve (`PlanNodeEditor.tsx:113-116`);
  after a page switch it still shows the previous iteration, and a content edit
  saves that text onto the newly mounted one.
- Every single-node mutation takes a path: regenerate, generate-and-review,
  improve, start and accept review, summary, save-to-file.

## Progress

`RegenerationPanel` shows a **set of active entries** `{nodeId, title, path}` and
per-container done/running/total, not one chain; an error card names the failing
path (`firstErrorAt`); dropped late results are counted. Today it renders a
single stack of full rows and hides a container line by object identity.

## Also in scope

- Hard-coded `for-each` in `GroupNode` (footer, icon), the "move to" targets and
  `PLAN_CONTAINER_NODE_TYPE_VALUES` generalise to container types.
- Reparenting a node changes its whole subtree's path space: the UI warns before a
  move that drops iteration state, and the server refuses a move that would create
  a rejected edge shape.
- In a parallel container several positions can show one iteration's state;
  editing it edits all of them, and the pager says so.
