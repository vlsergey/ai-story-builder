# Iteration state — UI

*2026-09-29. Part of the architecture proposal for review; see [README.md](README.md).*

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
  snapshots). Valued by **position**, not by hash key — parallel keys get renamed
  when they grow. Clamped when the list shrinks.
- Changing it writes nothing and works while the container is generating. The
  `forEachNodes.changePage` mutation goes away.
- **Follow the running iteration unless pinned.** During a run the pager follows
  the iteration being generated — today that happens implicitly, because the
  processor mounts each iteration. It is rebuilt as an explicit rule: follow until
  the user picks a page, then stay.

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
keys and per-iteration status counts — one `GROUP BY` over the container's
subtree at `path`. A precedence function in `src/shared/plan-graph.ts` rolls them
up: any running → running, any error → error, any stale or missing → stale, all
settled → generated, with counts such as "3/4 generated, 1 running". Kept in shared
so it is display-only and tested once; the pager reuses the per-iteration statuses
as page markers. It must not read EMPTY as stale — for-each-prev-outputs is EMPTY
on iteration 0 by design, and a loop would never look finished.

Computed on the backend because the client would otherwise need every iteration's
full state to paint one badge.

## Events

- Node events carry `{nodeId, path, kind: "definition" | "state"}` instead of a
  bare id. A definition event invalidates `findAll` and `getById({id})`; a state
  event invalidates `findStatesAtPath(path)`, `getById({id, path})` and
  `iterationStatuses` for each container segment of the path. Today every event
  invalidates every node query and rebuilds the whole graph.
- Stream events gain `path`: `[nodeId, path, contentPath, event]`. `contentPath`
  stays — it is a position inside the content and already carries fix-problems'
  own iteration index. Buffers in `ResponseStreamWatcher`, `TextNodeEditor` and
  `AiThinkingPanel` are keyed by `(nodeId, path)`; today two iterations of one node
  would be glued into one buffer.

## Editing a node in an iteration

- An editor panel is bound to `(id, path)` when it opens: panel id
  `plan-node-editor-${id}@${path}`, iteration shown in the tab title. Saved
  layouts with only `{nodeId}` open at `''`.
- Two groups, labelled visibly: **content, summary, review** go to the state at
  `(id, path)`; **title, prompts, settings** go to the definition, apply to every
  iteration and demote every path.
- The editor adopts server state whenever it holds no unsaved edits, and locks
  content while the state at its path is GENERATING. Today it never re-syncs
  (`useState(initialValue)`), so after a page switch its next save writes the old
  iteration's text onto the new one.
- Every single-node mutation takes a path: regenerate, improve, summary,
  accept-review, save-to-file.

## Progress

`RegenerationPanel` shows a **set of active entries** `{nodeId, title, path}` and
per-container done/running/total, not one chain; an error card names the failing
path (`firstErrorAt`). Today it renders a single stack of full rows and hides a
container line by object identity.

## Also in scope

- Hard-coded `for-each` in `GroupNode` (footer, icon), the "move to" targets and
  `PLAN_CONTAINER_NODE_TYPE_VALUES` generalise to container types.
- Reparenting a node changes its whole subtree's path space: the UI warns before a
  move that drops iteration state.
- In a parallel container several positions can show one iteration's state;
  editing it edits all of them, and the pager says so.
