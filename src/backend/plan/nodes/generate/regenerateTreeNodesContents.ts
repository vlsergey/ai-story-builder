import EventEmitter from "node:events"
import type { Observable } from "@trpc/server/observable"
import type { ResponseStreamEvent } from "openai/resources/responses/responses.js"
import { LOOP_TYPES } from "../../../../shared/loop-iterations.js"
import type { PlanNodeRow, PlanNodeStatus } from "../../../../shared/plan-graph.js"
import { childPath, type NodePath } from "../../../../shared/plan-node-path.js"
import type { RegenerateStatusEvent, RunningLoop, RunningNode } from "../../../../shared/RegenerateEvent.js"
import { maxConcurrentCalls } from "../../../ai/engine-slots.js"
import { emitterToObservable, emitterToSingleArgObservable } from "../../../lib/event-manager.js"
import { makeErrorWithStatus } from "../../../lib/make-errors.js"
import { finishRun, runForNode, startRun } from "../../../lib/telemetry/telemetry.js"
import { SettingsRepository } from "../../../settings/settings-repository.js"
import { hasState, PlanNodeService } from "../plan-node-service.js"
import { propagateStaleStatus } from "./propagateStaleStatus.js"
import type { PlanNodeAiGenerationStatus, RegenerationNodeContext } from "./RegenerationContext.js"
import { hasRegenerationCriteria } from "./regeneration-criteria.js"
import { type LoopProgress, type RunBook, type RunScope, schedule, unitKey } from "./schedule.js"

interface RegenerateEvents {
  responseStream: [nodeId: number, path: NodePath, contentPath: (string | number)[], event: ResponseStreamEvent]
  status: [event: RegenerateStatusEvent]
}

const eventEmitter = new EventEmitter<RegenerateEvents>()

function emitRegenerateStatusEvent() {
  const event: RegenerateStatusEvent = {
    inProcess,
    stopping: abortController == null ? true : abortController.signal.aborted,
    // A copy: subscribers may hold the event after the run has moved on.
    running: [...running.values()],
    loops: runningLoops,
    firstError,
    firstErrorAt,
    generatedNew,
    generatedSame,
    generatedEmpty,
    skipped,
  }
  eventEmitter.emit("status", event)
}

export function subscribeToStatusEvents(): Observable<RegenerateStatusEvent, unknown> {
  return emitterToSingleArgObservable(eventEmitter, "status")
}

interface ResponseStreamEventWrapper {
  nodeId: number
  /** The iteration the streaming node runs in: two iterations of one node stream apart. */
  path: NodePath
  contentPath: (string | number)[]
  event: ResponseStreamEvent
}

const eventEmitterTupleToEventMapper = ([nodeId, path, contentPath, event]: RegenerateEvents["responseStream"]) =>
  ({
    nodeId,
    path,
    contentPath,
    event,
  }) satisfies ResponseStreamEventWrapper

export function subscribeToResponseStreamEvents(): Observable<ResponseStreamEventWrapper, unknown> {
  return emitterToObservable(eventEmitter, "responseStream", eventEmitterTupleToEventMapper)
}

let abortController: AbortController | null = null
let inProcess = false

/** What is being written now, by unit, in the order it started. */
const running = new Map<string, RunningNode>()
/** The loops whose iterations run now, and how far they have got. */
let runningLoops: RunningLoop[] = []
let firstError: unknown = null
let firstErrorAt: RegenerateStatusEvent["firstErrorAt"] = null

let generatedNew: number = 0
let generatedSame: number = 0
let generatedEmpty: number = 0
let skipped: number = 0

/** How many times one unit may start in a run: more means cascades keep demoting it. */
const MAX_STARTS = 10

export function stop(): void {
  if (inProcess && !abortController?.signal.aborted) {
    abortController?.abort()
    emitRegenerateStatusEvent()
  }
}

const refOf = (row: PlanNodeRow) => ({ id: row.id, title: row.title, type: row.type, path: row.path })

/** Shows how far the loops have got — when that changed. */
function showLoops(progress: LoopProgress[]) {
  const next = progress.map(({ row, total, done, current }) => ({ node: refOf(row), total, done, current }))
  if (JSON.stringify(next) === JSON.stringify(runningLoops)) return
  runningLoops = next
  emitRegenerateStatusEvent()
}

/** How a finished regeneration is counted in the run's totals. */
function classifyResult(before: PlanNodeRow, after: PlanNodeRow): PlanNodeAiGenerationStatus {
  if ((after.content?.length || 0) === 0) return "EMPTY"
  return after.content === before.content ? "SAME" : "GENERATED"
}

/**
 * Generates what the graph needs, or — with a target — regenerates that node
 * at that path and resolves to its row afterwards.
 *
 * The graph says what may run now (see `schedule`); the run starts it, as
 * many units at once as the engine takes, and looks again whenever one ends.
 * A loop only opens its iterations; their nodes are units like any other, so
 * independent nodes run side by side wherever they are. Once a node has
 * failed nothing new starts, and what already runs is let finish.
 */
export async function regenerateTreeNodesContents(): Promise<undefined>
export async function regenerateTreeNodesContents(target: { nodeId: number; path: NodePath }): Promise<PlanNodeRow>
export async function regenerateTreeNodesContents(target?: {
  nodeId: number
  path: NodePath
}): Promise<PlanNodeRow | undefined> {
  if (inProcess) throw makeErrorWithStatus("Some regeneration is already in process", 429)
  inProcess = true
  firstError = null
  firstErrorAt = null
  running.clear()
  runningLoops = []

  generatedEmpty = 0
  generatedSame = 0
  generatedNew = 0
  skipped = 0

  const myAbortController = new AbortController()
  abortController = myAbortController
  const abortSignal = myAbortController.signal
  let failed = false
  emitRegenerateStatusEvent()

  const options = {
    regenerateGenerated: SettingsRepository.getAiRegenerateGenerated(),
    regenerateManual: SettingsRepository.getAiRegenerateManual(),
  }

  console.info("[regenerateTreeNodesContents] Starting regeneration")
  // Propagate stale status before the run starts. Without this, a GENERATED
  // downstream node looks done while an upstream (or a loop's child in some
  // iteration) still has OUTDATED/ERROR/EMPTY status.
  const { marked } = propagateStaleStatus({
    regenerateManual: options.regenerateManual,
    regenerateGenerated: options.regenerateGenerated,
  })
  if (marked.length > 0) {
    const list = marked.map(({ nodeId, path }) => (path ? `${nodeId}@${path}` : `${nodeId}`)).join(",")
    console.info(`[regenerateTreeNodesContents] pre-marked OUTDATED via propagation: ${list}`)
  }

  const service = new PlanNodeService()

  const shouldRegenerate: Record<PlanNodeStatus, boolean> = {
    ERROR: true,
    EMPTY: true,
    GENERATING: true,
    GENERATED: options.regenerateGenerated,
    OUTDATED: true,
    MANUAL: options.regenerateManual,
  }

  /** The first failure is the run's: it names the node, and nothing new starts after it. */
  function recordFailure(row: PlanNodeRow, e: unknown) {
    if (abortSignal.aborted) return // a stop is not a failure
    if (firstError == null) {
      firstError = e
      firstErrorAt = { nodeId: row.id, title: row.title, path: row.path }
    }
    failed = true
  }

  function count(status: PlanNodeAiGenerationStatus) {
    if (status === "SAME") generatedSame++
    else if (status === "EMPTY") generatedEmpty++
    else generatedNew++
  }

  function nodeContext(row: PlanNodeRow): RegenerationNodeContext {
    const key = unitKey(row.id, row.path)
    return {
      abortSignal,
      nodeId: row.id,
      path: row.path,
      options,
      onResponseStreamEvent: (contentPath: (string | number)[], event: ResponseStreamEvent) => {
        if (abortSignal.aborted) throw Error("Stop was required")
        eventEmitter.emit("responseStream", row.id, row.path, contentPath, event)
      },
      asCycle: async (total, block) =>
        block({
          abortSignal,
          options,
          asNode: async (index, attempt) => {
            if (abortSignal.aborted) throw Error("Stop was required")
            const entry = running.get(key)
            if (entry) {
              running.set(key, { ...entry, attempt: { index, total } })
              emitRegenerateStatusEvent()
            }
            return await attempt(nodeContext(row))
          },
        }),
    }
  }

  /** Runs `block` shown among what runs now. */
  async function shownRunning<T>(row: PlanNodeRow, block: () => Promise<T>): Promise<T> {
    const key = unitKey(row.id, row.path)
    running.set(key, { node: refOf(row) })
    emitRegenerateStatusEvent()
    try {
      return await runForNode({ nodeId: row.id, path: row.path }, block)
    } finally {
      running.delete(key)
      emitRegenerateStatusEvent()
    }
  }

  /** One node, not a loop: regenerated and counted. */
  async function regenerateNode(row: PlanNodeRow): Promise<PlanNodeRow> {
    const after = await shownRunning(row, () => service.regenerate(nodeContext(row)))
    count(classifyResult(row, after))
    return after
  }

  /**
   * Runs the graph — or, with a scope, one loop and all inside it — until
   * nothing is left to do, the run is stopped, or a node has failed.
   */
  async function orchestrate(scope: RunScope): Promise<void> {
    const book: RunBook = { done: new Set(), running: new Set(), opened: new Map(), revisit: new Set() }
    /** The loops' rows before they opened: what their result is compared with. */
    const beforeOpening = new Map<string, PlanNodeRow>()
    const tasks = new Map<string, Promise<void>>()
    const starts = new Map<string, number>()
    // The target of a single-node run runs whatever its status says.
    const forced = scope ? unitKey(scope.loop.nodeId, scope.loop.path) : null

    const limit = () => {
      const engine = SettingsRepository.getCurrentBackend()
      return engine ? maxConcurrentCalls(engine) : 1
    }
    const mustRun = (row: PlanNodeRow, key: string) =>
      key === forced || book.revisit.has(key) || (shouldRegenerate[row.status] && hasRegenerationCriteria(row))

    function start(row: PlanNodeRow) {
      const key = unitKey(row.id, row.path)
      const started = (starts.get(key) ?? 0) + 1
      starts.set(key, started)
      if (started > MAX_STARTS) {
        recordFailure(row, Error(`Regeneration did not converge: «${row.title}» at "${row.path}" kept being demoted`))
        return
      }
      book.running.add(key)
      const task = (async () => {
        try {
          if (LOOP_TYPES.has(row.type)) {
            book.revisit.delete(key)
            const opened = await shownRunning(row, () => service.openLoop(nodeContext(row)))
            // Null: the row changed meanwhile. Not done, not opened: it runs again.
            if (opened) {
              book.opened.set(key, opened)
              beforeOpening.set(key, row)
            }
          } else {
            await regenerateNode(row)
            book.done.add(key)
          }
        } catch (e) {
          recordFailure(row, e)
        } finally {
          book.running.delete(key)
          tasks.delete(key)
        }
      })()
      tasks.set(key, task)
    }

    async function close(row: PlanNodeRow) {
      const key = unitKey(row.id, row.path)
      const opened = book.opened.get(key)
      if (!opened) return
      book.opened.delete(key)
      try {
        const after = await runForNode({ nodeId: row.id, path: row.path }, () =>
          service.closeLoop(opened, nodeContext(opened.row)),
        )
        count(classifyResult(beforeOpening.get(key) ?? row, after))
        book.done.add(key)
      } catch (e) {
        recordFailure(row, e)
      }
    }

    /** A unit with nothing to do: settled as it is. */
    async function skip(row: PlanNodeRow) {
      console.log(
        `[regenerateTreeNodesContents] skipping node ${row.id} '${row.title}' of type ${row.type} with status '${row.status}' at "${row.path}"`,
      )
      // A node with nothing to generate from settles here: pending, it would
      // stay pending for good. What it holds is the user's; nothing is EMPTY.
      if (!hasRegenerationCriteria(row) && (!hasState(row) || row.status === "OUTDATED")) {
        await service.patchState(row.id, row.path, false, { status: row.content?.trim() ? "MANUAL" : "EMPTY" })
      }
      skipped++
      emitRegenerateStatusEvent()
    }

    try {
      for (;;) {
        if (!abortSignal.aborted && !failed) {
          const { ready, closable, loops, pending } = schedule(service, book, scope)
          showLoops(loops)
          if (closable.length > 0) {
            for (const row of closable) await close(row)
            continue
          }

          // In the graph's order: a loop gets its earlier iterations done
          // first, so a run stopped half-way leaves whole iterations behind.
          let settledAny = false
          for (const row of ready) {
            // A start or a skip may have ended the run: nothing new after it.
            if (abortSignal.aborted || failed) break
            const key = unitKey(row.id, row.path)
            if (!mustRun(row, key)) {
              await skip(row)
              book.done.add(key)
              settledAny = true
            } else if (tasks.size < limit()) {
              start(row)
            }
          }
          // A skip may have made more units ready.
          if (settledAny) continue
          if (tasks.size === 0) {
            if (abortSignal.aborted || failed) break
            if (pending.length > 0) {
              const stuck = pending[0]
              firstErrorAt = { nodeId: stuck.id, title: stuck.title, path: stuck.path }
              const named = pending.slice(0, 5).map((row) => `«${row.title}» at "${row.path}"`)
              throw Error(`Regeneration cannot proceed: ${named.join(", ")} wait for each other`)
            }
            return
          }
        } else if (tasks.size === 0) {
          break
        }
        // Tasks never reject: a failure is recorded where it happens.
        await Promise.race(tasks.values())
      }
    } finally {
      // Whatever ended the loop, the run does not end while units still write.
      await Promise.allSettled([...tasks.values()])
      // Stopped or failed with loops still open: a loop around the failure
      // failed with it; the others were cut short, to be redone. One that
      // cannot be written — deleted meanwhile — must not keep the others
      // GENERATING, nor stand in for how the run ended.
      for (const [key, opened] of book.opened) {
        const inside = childPath(opened.row.path, opened.row.id, "")
        const failedInside = failed && firstErrorAt !== null && firstErrorAt?.path.startsWith(inside) === true
        try {
          await service.abandonLoop(opened, failedInside ? "ERROR" : "OUTDATED")
        } catch (e) {
          console.error(
            `[regenerateTreeNodesContents] could not leave loop ${opened.row.id} at "${opened.row.path}"`,
            e,
          )
        }
        book.opened.delete(key)
      }
      showLoops([])
    }
  }

  startRun()
  let runSucceeded = true
  try {
    if (target === undefined) {
      await orchestrate(null)
    } else {
      service.checkPath(target.nodeId, target.path)
      const node = service.getRow(target.nodeId, target.path)
      if (LOOP_TYPES.has(node.type)) {
        await orchestrate({ loop: target })
      } else {
        try {
          await regenerateNode(node)
        } catch (e) {
          recordFailure(node, e)
        }
      }
    }
    if (failed) throw firstError
    // A stopped run did not do its work: its caller learns so, as from a failure.
    if (abortSignal.aborted) throw Error("Stop was required")
    return target === undefined ? undefined : service.getRow(target.nodeId, target.path)
  } catch (err) {
    runSucceeded = false
    if (firstError == null && !abortSignal.aborted) {
      firstError = err
    }
    throw err
  } finally {
    finishRun({ success: runSucceeded })
    inProcess = false
    abortController = null
    emitRegenerateStatusEvent()
  }
}
