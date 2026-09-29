import { promises as fs } from "node:fs"
import type { Observable } from "@trpc/server/observable"
import type { ResponseStreamEvent } from "openai/resources/responses/responses.js"
import { loopLength } from "../../../shared/for-each-plan-node.js"
import {
  type EdgeTypeToOutputTypeMap,
  getNodeTypeDefinition,
  isValidNodeType,
  NODE_TYPES,
} from "../../../shared/node-edge-dictionary.js"
import type { PlanEdgeType } from "../../../shared/plan-edge-types.js"
import {
  PLAN_NODE_DEFINITION_KEYS,
  PLAN_NODE_STATE_KEYS,
  type PlanNodeCreate,
  type PlanNodeDefinition,
  type PlanNodeDefinitionUpdate,
  type PlanNodeRow,
  type PlanNodeState,
  type PlanNodeStateBrief,
  type PlanNodeStateUpdate,
  type PlanNodeStatus,
  type PlanNodeUpdate,
} from "../../../shared/plan-graph.js"
import {
  lastSegment,
  type NodePath,
  parentPath,
  parsePath,
  pathDepth,
  ROOT_PATH,
  truncatePath,
} from "../../../shared/plan-node-path.js"
import type { PlanNodeType } from "../../../shared/plan-node-types.js"
import { generateSummary } from "../../ai/generate-summary.js"
import { withDbTransaction } from "../../db/connection.js"
import { type DataOrEventEvent, toObservable } from "../../lib/event-manager.js"
import { makeErrorWithStatus } from "../../lib/make-errors.js"
import { improvePlanNodeContent } from "../../routes/improve-plan-node-content.js"
import { SettingsRepository } from "../../settings/settings-repository.js"
import { PlanEdgeRepository } from "../edges/plan-edge-repository.js"
import type { RegenerationNodeContext } from "./generate/RegenerationContext.js"
import { FixProblemsProcessor } from "./graph/fix-problems-processor.js"
import { ForEachIndexProcessor } from "./graph/for-each-index-processor.js"
import { ForEachInputProcessor } from "./graph/for-each-input-processor.js"
import { ForEachOutputProcessor } from "./graph/for-each-output-processor.js"
import { ForEachPrevOutputsProcessor } from "./graph/for-each-prev-outputs-processor.js"
import { ForEachProcessor } from "./graph/for-each-processor.js"
import { FormatProcessor } from "./graph/format-processor.js"
import { LoreProcessor } from "./graph/lore-processor.js"
import { MergeProcessor } from "./graph/merge-processor.js"
import type { NodeProcessor } from "./graph/node-processor.js"
import { ScriptProcessor } from "./graph/script-processor.js"
import { mergeNodeSettings } from "./graph/settings-helper.js"
import { SplitProcessor } from "./graph/split-processor.js"
import { TextProcessor } from "./graph/text-processor.js"
import { usesInput } from "./input-relevance.js"
import type { NodeInputs } from "./NodeInput.js"
import { planNodeEventManager } from "./plan-node-event-manager.js"
import { PlanNodeRepository } from "./plan-node-repository.js"
import { type PlanNodeStateRecord, PlanNodeStateRepository } from "./plan-node-state-repository.js"

export const NODE_PROCESSORS: Record<PlanNodeType, NodeProcessor> = {
  "fix-problems": new FixProblemsProcessor(),
  "for-each": new ForEachProcessor(),
  "for-each-index": new ForEachIndexProcessor(),
  "for-each-input": new ForEachInputProcessor(),
  "for-each-output": new ForEachOutputProcessor(),
  "for-each-prev-outputs": new ForEachPrevOutputsProcessor(),
  text: new TextProcessor(),
  lore: new LoreProcessor(),
  split: new SplitProcessor(),
  merge: new MergeProcessor(),
  script: new ScriptProcessor(),
  format: new FormatProcessor(),
}

/** Node types that hold iterations: their children have one state per iteration. */
export const LOOP_TYPES: ReadonlySet<PlanNodeType> = new Set(["for-each"])

/**
 * Statuses a changed input demotes. MANUAL is the user's own text; OUTDATED
 * and ERROR will re-run anyway. A GENERATING node is demoted so that the result
 * it is computing from the old input does not land.
 */
const DEMOTABLE_BY_INPUT_CHANGE: ReadonlySet<PlanNodeStatus> = new Set(["GENERATED", "GENERATING", "EMPTY"])

/**
 * Statuses a new prompt or settings demote, in every iteration. MANUAL stays
 * the user's. A GENERATING row is demoted so that the result it is computing
 * from the old prompt does not land.
 */
const DEMOTABLE_BY_DEFINITION_CHANGE: PlanNodeStatus[] = ["GENERATED", "GENERATING", "EMPTY", "ERROR"]

/**
 * The state of a node that has produced nothing in an iteration yet: pending
 * work, shown as OUTDATED. An empty `rev` marks it as not stored.
 */
const PENDING_STATE: PlanNodeState = {
  content: null,
  summary: null,
  status: "OUTDATED",
  word_count: 0,
  char_count: 0,
  byte_count: 0,
  in_review: 0,
  review_base_content: null,
  ai_improve_instruction: null,
  rev: "",
}

/** Whether the row is stored, rather than the pending state of an iteration nothing ran in yet. */
export function hasState(row: PlanNodeRow): boolean {
  return row.rev !== ""
}

/**
 * The status a finished regeneration stores. A processor that reported ERROR
 * (a script or template failure) or EMPTY is believed; otherwise the output
 * decides. A list is output even when empty: a split that found no side plots
 * has answered, and an EMPTY there would be retried — and would demote
 * everything downstream — on every run. Other reported statuses are not
 * trusted: some processors return their whole row, GENERATING included.
 */
function outcomeStatus(reported: PlanNodeStatus | undefined, output: unknown): PlanNodeStatus {
  if (reported === "ERROR" || reported === "EMPTY") return reported
  return Array.isArray(output) || output ? "GENERATED" : "EMPTY"
}

function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>
  for (const key of keys) if (source[key] !== undefined) out[key] = source[key]
  return out
}

function compose(definition: PlanNodeDefinition, path: NodePath, state?: PlanNodeStateRecord): PlanNodeRow {
  const stored = state ? pick(state, [...PLAN_NODE_STATE_KEYS, "rev"]) : {}
  return { ...definition, ...PENDING_STATE, ...stored, path }
}

/**
 * Service for plan node operations.
 * A node's definition is the same in every iteration of its loops; its state
 * is per iteration, at a path. Most operations take the path they act at.
 */
export class PlanNodeService {
  readonly repo: PlanNodeRepository = new PlanNodeRepository()
  readonly states: PlanNodeStateRepository = new PlanNodeStateRepository()
  private readonly loopsCache = new Map<number, number[]>()

  // ─── Definitions ─────────────────────────────────────────────────────────────

  getDefinition(id: number): PlanNodeDefinition {
    const result = this.repo.findById(id)
    if (!result) throw makeErrorWithStatus(`Plan node ${id} not found`, 404)
    return result
  }

  findByParentId(parentId: number | null): PlanNodeDefinition[] {
    return this.repo.findByParentId(parentId)
  }

  findByParentIdAndType(parentId: number | null, type: PlanNodeType): PlanNodeDefinition[] {
    return this.repo.findByParentIdAndType(parentId, type)
  }

  count(): number {
    return this.repo.count()
  }

  getProcessor(nodeType: PlanNodeType): NodeProcessor {
    return NODE_PROCESSORS[nodeType]
  }

  getNodeSettings(node: PlanNodeDefinition): unknown {
    const processor = this.getProcessor(node.type)
    if (!processor) return {}
    return mergeNodeSettings(processor.defaultSettings as Record<string, any>, node.node_type_settings)
  }

  // ─── Loops and paths ─────────────────────────────────────────────────────────

  /** The loops a node sits in, outermost first. */
  loopsAround(nodeId: number): number[] {
    const cached = this.loopsCache.get(nodeId)
    if (cached) return cached
    const loops: number[] = []
    let parentId = this.repo.findById(nodeId)?.parent_id ?? null
    while (parentId !== null) {
      const parent = this.repo.findById(parentId)
      if (!parent) break
      if (LOOP_TYPES.has(parent.type)) loops.unshift(parent.id)
      parentId = parent.parent_id
    }
    this.loopsCache.set(nodeId, loops)
    return loops
  }

  /** How many path segments a node's states have. */
  depthOf(nodeId: number): number {
    return this.loopsAround(nodeId).length
  }

  /**
   * Where a consumer running at `path` reads `sourceId`: the prefix of its
   * path that names the loops the source is in. A source in a loop the
   * consumer is not in has no iteration to read from, and is refused.
   */
  readPath(sourceId: number, consumerId: number, path: NodePath): NodePath {
    this.checkEdge(sourceId, consumerId)
    return truncatePath(path, this.depthOf(sourceId))
  }

  /**
   * Refuses an edge the engine cannot resolve: one whose source sits in a loop
   * its reader is not in — leaving a loop past its output, or crossing into a
   * sibling loop. There is no single iteration such a reader could read.
   */
  checkEdge(sourceId: number, consumerId: number): void {
    const sourceLoops = this.loopsAround(sourceId)
    const consumerLoops = this.loopsAround(consumerId)
    if (sourceLoops.some((loop, i) => consumerLoops[i] !== loop)) {
      const source = this.repo.findById(sourceId)?.title
      const consumer = this.repo.findById(consumerId)?.title
      throw makeErrorWithStatus(
        `«${consumer}» reads «${source}» from inside a loop it is not in; move the edge through the loop's output`,
        400,
      )
    }
  }

  /**
   * Refuses a path that names no current iteration of the node: one whose
   * loops are not the node's, or whose index is past what its loop has. An
   * editor still open on an iteration that vanished must not write it back.
   */
  checkPath(nodeId: number, path: NodePath): void {
    const loops = this.loopsAround(nodeId)
    const segments = parsePath(path)
    const current =
      segments.length === loops.length &&
      segments.every(
        (segment, depth) =>
          segment.containerId === loops[depth] &&
          Number(segment.key) < loopLength(this.states.find(segment.containerId, truncatePath(path, depth))?.content),
      )
    if (!current) {
      const title = this.repo.findById(nodeId)?.title
      throw makeErrorWithStatus(`«${title}» has no iteration "${path}" any more`, 404)
    }
  }

  // ─── Rows ────────────────────────────────────────────────────────────────────

  /** The node as the iteration at `path` sees it; pending state if it has produced nothing there. */
  getRow(id: number, path: NodePath): PlanNodeRow {
    return compose(this.getDefinition(id), path, this.states.find(id, path))
  }

  /** What the graph shows of every node that has produced something at exactly `path`. */
  findStatesAtPath(path: NodePath): PlanNodeStateBrief[] {
    const loops = new Set(
      this.repo
        .findAll()
        .filter((n) => LOOP_TYPES.has(n.type))
        .map((n) => n.id),
    )
    return this.states.findAtPath(path).map((state) => ({
      node_id: state.node_id,
      path: state.path,
      status: state.status,
      summary: state.summary,
      word_count: state.word_count,
      char_count: state.char_count,
      byte_count: state.byte_count,
      in_review: state.in_review,
      rev: state.rev,
      ...(loops.has(state.node_id) ? { iterations: loopLength(state.content) } : {}),
    }))
  }

  /** The nodes `nodeId` reads, each as the iteration at `path` reads it. */
  findInputRows(nodeId: number, path: NodePath): PlanNodeRow[] {
    return this.findNodeInputs(nodeId, path).map((input) => input.sourceNode)
  }

  // ─── Inputs ──────────────────────────────────────────────────────────────────

  findNodeInputs(nodeId: number, path: NodePath): NodeInputs<unknown> {
    return this.resolveInputs(nodeId, path, new PlanEdgeRepository().findByToNodeId(nodeId))
  }

  findNodeInputsByType<T extends PlanEdgeType>(
    nodeId: number,
    path: NodePath,
    type: T,
  ): NodeInputs<EdgeTypeToOutputTypeMap[T]> {
    return this.resolveInputs(nodeId, path, new PlanEdgeRepository().findByToNodeIdAndType(nodeId, type)) as NodeInputs<
      EdgeTypeToOutputTypeMap[T]
    >
  }

  private resolveInputs(
    nodeId: number,
    path: NodePath,
    edges: ReturnType<PlanEdgeRepository["findAll"]>,
  ): NodeInputs<unknown> {
    const inputs: NodeInputs<unknown> = []
    for (const edge of edges) {
      const source = this.repo.findById(edge.from_node_id)
      if (!source) continue
      const processor = this.getProcessor(source.type)
      if (!processor) continue
      const sourceNode = this.getRow(source.id, this.readPath(source.id, nodeId, path))
      inputs.push({ edge, sourceNode, input: processor.getOutput(this, sourceNode) })
    }
    return inputs.sort((a, b) => a.edge.position - b.edge.position)
  }

  // ─── Writes ──────────────────────────────────────────────────────────────────

  /**
   * An edit as the editor sends it: definition fields apply to the node in
   * every iteration, state fields to the iteration at `path`. With
   * `expectedRev`, the state fields land only if nothing wrote that iteration
   * since the editor read it; otherwise the edit fails with 409 and the
   * editor decides.
   */
  async patch(
    nodeId: number,
    path: NodePath,
    manual: boolean,
    data: PlanNodeUpdate,
    expectedRev?: string,
  ): Promise<PlanNodeRow> {
    const definition = pick(data, PLAN_NODE_DEFINITION_KEYS)
    const state = pick(data, PLAN_NODE_STATE_KEYS)
    if (Object.keys(state).length > 0) this.checkPath(nodeId, path)
    if (Object.keys(definition).length > 0) await this.patchDefinition(nodeId, definition)
    if (Object.keys(state).length > 0 && !(await this.patchState(nodeId, path, manual, state, expectedRev))) {
      throw makeErrorWithStatus("The node changed since the editor read it", 409)
    }
    return this.getRow(nodeId, path)
  }

  /** Changes what the node is. A new prompt or settings demote it in every iteration. */
  async patchDefinition(nodeId: number, data: PlanNodeDefinitionUpdate): Promise<PlanNodeDefinition> {
    const before = this.getDefinition(nodeId)
    if (data.parent_id !== undefined && data.parent_id !== before.parent_id) this.checkMove(before, data.parent_id)

    let after: PlanNodeDefinition
    try {
      // A move and what it does to the subtree's state land together, or not at all.
      after = withDbTransaction(() => {
        const patched = Object.keys(data).length > 0 ? this.repo.patch(nodeId, data) : before
        this.loopsCache.clear()
        if (patched.parent_id !== before.parent_id) this.relocated(nodeId, before)
        return patched
      })
    } finally {
      this.loopsCache.clear()
    }
    planNodeEventManager.emitUpdate(nodeId, `patched keys: ${Object.keys(data).join(", ")}`)

    if (after.node_type_settings !== before.node_type_settings) this.demoteEverywhere(nodeId)
    return after
  }

  /**
   * Changes what the node produced in the iteration at `path`. With
   * `expectedRev`, only if nothing wrote it since that revision was read;
   * returns null when something did. A change of content reaches everything
   * that reads it.
   */
  async patchState(
    nodeId: number,
    path: NodePath,
    manual: boolean,
    data: PlanNodeStateUpdate,
    expectedRev?: string,
  ): Promise<PlanNodeRow | null> {
    const before = this.getRow(nodeId, path)
    let update: PlanNodeStateUpdate = { ...data }
    if (update.status === undefined && update.content !== undefined) {
      update.status = !update.content ? "EMPTY" : manual ? "MANUAL" : "GENERATED"
    }
    if (update.content !== undefined) update = { ...update, ...this.countsOf({ ...before, ...update }) }

    const record =
      expectedRev === undefined
        ? this.states.upsert(nodeId, path, update)
        : this.states.updateIfUnchanged(nodeId, path, update, expectedRev)
    if (!record) return null
    const after = compose(before, path, record)
    planNodeEventManager.emitUpdate(nodeId, `state at "${path}": ${Object.keys(data).join(", ")}`)

    if (after.content !== before.content) await this.markAsOutdatedAndNotifyDownstreamNodes(nodeId, path)
    return after
  }

  /**
   * Patches several nodes' definitions, one after another, as a drag of several
   * nodes in the graph does. Each patch is awaited, so the call returns once
   * all are stored and a failure reaches the caller.
   */
  async batchPatch(items: { id: number; data: PlanNodeDefinitionUpdate }[]): Promise<void> {
    for (const { id, data } of items) {
      await this.patchDefinition(id, pick(data, PLAN_NODE_DEFINITION_KEYS))
    }
  }

  /** A new prompt, new settings, a new template: every iteration's result is stale. */
  demoteEverywhere(nodeId: number): void {
    const demoted = this.states.setStatusForNode(nodeId, DEMOTABLE_BY_DEFINITION_CHANGE, "OUTDATED")
    if (demoted.length > 0) planNodeEventManager.emitUpdate(nodeId, `demoted in ${demoted.length} iteration(s)`)
  }

  private checkMove(node: PlanNodeDefinition, newParentId: number | null): void {
    if (getNodeTypeDefinition(node.type)?.confined) {
      throw makeErrorWithStatus(`Node type ${node.type} cannot be moved`, 403)
    }
    if (newParentId === node.id) throw makeErrorWithStatus("cannot set parent to itself", 400)
    if (newParentId !== null && !this.repo.findById(newParentId)) {
      throw makeErrorWithStatus("target parent does not exist", 400)
    }
    this.checkContainer(node.type, newParentId)
    for (let cur: number | null = newParentId; cur !== null; cur = this.repo.findById(cur)?.parent_id ?? null) {
      if (cur === node.id) throw makeErrorWithStatus("cannot move node into its own descendant", 400)
    }
  }

  /** Refuses a node type in a container its definition does not allow it in. */
  private checkContainer(type: PlanNodeType, parentId: number | null): void {
    const allowed = getNodeTypeDefinition(type)?.allowedContainers
    if (!allowed) return
    const container = parentId === null ? "root" : this.repo.findById(parentId)?.type
    if (!allowed.some((c) => c === container)) {
      throw makeErrorWithStatus(`A ${type} node cannot be placed in ${container ?? "a missing node"}`, 400)
    }
  }

  /**
   * A node moved. If it moved into or out of a loop, its paths — and its
   * subtree's — mean nothing any more: their state goes, and it is produced
   * again where the node now is.
   */
  private relocated(nodeId: number, before: PlanNodeDefinition): void {
    const oldLoops = this.loopsAroundParent(before.parent_id)
    const newLoops = this.loopsAround(nodeId)
    if (oldLoops.length === newLoops.length && oldLoops.every((loop, i) => newLoops[i] === loop)) return
    const subtree = this.subtreeIds(nodeId)
    // An edge that was fine where the node stood may now leave a loop past its output.
    const edges = new PlanEdgeRepository()
    for (const id of subtree) {
      for (const edge of [...edges.findByToNodeId(id), ...edges.findByFromNodeId(id)]) {
        this.checkEdge(edge.from_node_id, edge.to_node_id)
      }
    }
    this.states.deleteAtOrBelow(ROOT_PATH, subtree)
    if (newLoops.length === 0) {
      for (const id of subtree) if (this.depthOf(id) === 0) this.states.upsert(id, ROOT_PATH, { status: "OUTDATED" })
    }
  }

  private loopsAroundParent(parentId: number | null): number[] {
    if (parentId === null) return []
    const parent = this.repo.findById(parentId)
    if (!parent) return []
    return [...this.loopsAround(parent.id), ...(LOOP_TYPES.has(parent.type) ? [parent.id] : [])]
  }

  private subtreeIds(nodeId: number): number[] {
    const ids = [nodeId]
    for (let i = 0; i < ids.length; i++) for (const child of this.repo.findByParentId(ids[i])) ids.push(child.id)
    return ids
  }

  // ─── Cascade ─────────────────────────────────────────────────────────────────

  /**
   * The content of `changedId` at `path` changed. Its readers are demoted in
   * the iterations that read that path: a sibling at the same path; a node
   * inside a loop the changed node is outside of, in every one of its
   * iterations. A loop's output leaving through the loop reaches the loop's
   * readers; in a sequential loop it also reaches the later iterations.
   */
  async markAsOutdatedAndNotifyDownstreamNodes(changedId: number, path: NodePath): Promise<void> {
    const changed = this.repo.findById(changedId)
    if (!changed) return
    for (const edge of new PlanEdgeRepository().findByFromNodeId(changedId)) {
      const consumer = this.repo.findById(edge.to_node_id)
      if (!consumer) continue
      // A consumer that does not read this input cannot go stale from it.
      if (!usesInput(consumer, changed)) continue
      for (const consumerPath of this.pathsReading(consumer.id, path)) {
        await this.notifyConsumer(consumer, consumerPath, changedId)
      }
    }
    await this.loopOutputChanged(changed, path)
  }

  /** The paths at which `consumerId` reads a node at `sourcePath`. */
  private pathsReading(consumerId: number, sourcePath: NodePath): NodePath[] {
    const depth = this.depthOf(consumerId)
    if (depth <= pathDepth(sourcePath)) return [truncatePath(sourcePath, depth)]
    // Deeper than its source: it reads it from every iteration it has below that path.
    return this.states
      .findAtOrBelow(sourcePath, [consumerId])
      .map((state) => state.path)
      .filter((path) => pathDepth(path) === depth)
  }

  private async notifyConsumer(consumer: PlanNodeDefinition, path: NodePath, changedId: number): Promise<void> {
    const row = this.getRow(consumer.id, path)
    let update: PlanNodeStateUpdate =
      hasState(row) && DEMOTABLE_BY_INPUT_CHANGE.has(row.status) ? { status: "OUTDATED" } : {}
    const processor = this.getProcessor(consumer.type)
    if (processor?.onInputContentChange) {
      const settings = this.getNodeSettings(consumer)
      update = {
        ...update,
        ...(await processor.onInputContentChange(this, { ...row, ...update }, changedId, settings)),
      }
    }
    const changes = Object.keys(update).filter(
      (key) => update[key as keyof PlanNodeStateUpdate] !== row[key as keyof PlanNodeStateUpdate],
    )
    // A pending iteration has nothing to demote: it will run anyway.
    if (changes.length === 0 || (!hasState(row) && changes.every((key) => key === "status"))) return
    console.log(`[PlanNodeService] ${consumer.id} at "${path}" follows a change in ${changedId}: ${changes}`)
    await this.patchState(consumer.id, path, false, update)
  }

  /** A loop's output child changed in one iteration: the loop's own output changed. */
  private async loopOutputChanged(changed: PlanNodeDefinition, path: NodePath): Promise<void> {
    if (changed.type !== "for-each-output" || changed.parent_id === null) return
    const loop = this.repo.findById(changed.parent_id)
    if (!loop || !LOOP_TYPES.has(loop.type)) return
    const loopPath = parentPath(path)
    const iteration = Number(lastSegment(path)?.key)

    await this.markAsOutdatedAndNotifyDownstreamNodes(loop.id, loopPath)

    // A sequential loop's later iterations read the earlier outputs.
    for (const previous of this.repo.findByParentIdAndType(loop.id, "for-each-prev-outputs")) {
      for (const state of this.states.findAtOrBelow(loopPath, [previous.id])) {
        if (pathDepth(state.path) !== pathDepth(path)) continue
        if (Number(lastSegment(state.path)?.key) <= iteration) continue
        if (!DEMOTABLE_BY_INPUT_CHANGE.has(state.status)) continue
        await this.patchState(previous.id, state.path, false, { status: "OUTDATED" })
      }
    }
  }

  // ─── Create and delete ───────────────────────────────────────────────────────

  create(data: PlanNodeCreate): { id: number } {
    if (!data.title) throw makeErrorWithStatus("title required", 400)
    if (data.type !== undefined && !isValidNodeType(data.type)) {
      const valid = NODE_TYPES.map((nt) => nt.id).join(", ")
      throw makeErrorWithStatus(`Invalid node type "${data.type}". Valid types: ${valid}`, 400)
    }
    const type = data.type
    const nodeDef = NODE_TYPES.find((nt) => nt.id === type)
    if (nodeDef && nodeDef.canCreate === false) {
      throw makeErrorWithStatus(`Node type "${type}" cannot be created manually.`, 400)
    }

    this.checkContainer(type ?? "text", data.parent_id ?? null)

    const id = withDbTransaction(() => {
      const id = this.repo.insert({ ...pick(data, PLAN_NODE_DEFINITION_KEYS), title: data.title, type })
      if (type === "for-each") this.createForEachInternalNodes(id, data.x ?? 0, data.y ?? 0)
      this.writeInitialState(id, data.content ?? null, data.summary ?? null)
      return id
    })
    console.info(`Created node ${id} of type ${type}`)
    planNodeEventManager.emitUpdate(id)
    return { id }
  }

  /**
   * The state a new node starts with. Outside loops a node has its one row
   * from the start: its content if it has any — then it is the user's —
   * otherwise EMPTY. Inside a loop rows appear as the loop's iterations run,
   * and content has no iteration to go to.
   */
  writeInitialState(nodeId: number, content: string | null, summary: string | null = null): void {
    const hasContent = !!content && content.trim() !== ""
    if (this.depthOf(nodeId) > 0) {
      if (hasContent) {
        const title = this.repo.findById(nodeId)?.title
        throw makeErrorWithStatus(`«${title}» is inside a loop: its content belongs to an iteration`, 400)
      }
      return
    }
    this.states.upsert(nodeId, ROOT_PATH, {
      content,
      summary,
      status: hasContent ? "MANUAL" : "EMPTY",
      ...this.countsOf({ ...this.getRow(nodeId, ROOT_PATH), content }),
    })
  }

  /** The internal input and output nodes of a loop; they cannot be deleted. */
  private createForEachInternalNodes(parentId: number, parentX: number, parentY: number): void {
    const inputId = this.repo.insert({
      type: "for-each-input",
      title: "Input",
      parent_id: parentId,
      x: parentX - 50,
      y: parentY + 50,
      node_type_settings: JSON.stringify({}),
    })
    const outputId = this.repo.insert({
      type: "for-each-output",
      title: "Output",
      parent_id: parentId,
      x: parentX + 50,
      y: parentY + 50,
      node_type_settings: JSON.stringify({}),
    })
    console.info(`Created internal nodes for for-each ${parentId}: input ${inputId}, output ${outputId}`)
  }

  delete(id: number) {
    console.log(`Deleting node with id ${id}`)
    if (!this.repo.findById(id)) throw makeErrorWithStatus("node not found", 404)
    const subtree = this.subtreeIds(id)
    for (const nodeId of subtree) new PlanEdgeRepository().deleteByNodeId(nodeId)
    this.states.deleteAtOrBelow(ROOT_PATH, subtree)
    this.repo.delete(id)
    this.loopsCache.clear()
    planNodeEventManager.emitUpdate(id)
  }

  // ─── Regeneration ────────────────────────────────────────────────────────────

  async regenerate<T extends Record<string, any> = Record<string, any>>(
    context: RegenerationNodeContext,
  ): Promise<PlanNodeRow> {
    const { nodeId, path } = context
    const node = (await this.patchState(nodeId, path, false, { status: "GENERATING" })) as PlanNodeRow

    try {
      const nodeProcessor = this.getProcessor(node.type) as NodeProcessor<T>

      let patch: PlanNodeStateUpdate = {}
      if (nodeProcessor.regenerate) {
        const settings =
          node.node_type_settings !== null
            ? mergeNodeSettings(nodeProcessor.defaultSettings, node.node_type_settings)
            : nodeProcessor.defaultSettings
        patch = pick((await nodeProcessor.regenerate(this, context, node, settings)) || {}, PLAN_NODE_STATE_KEYS)
      }

      if (context.abortSignal.aborted) {
        console.warn("[PlanNodeService]", "regenerate", `Stop node ${nodeId} regeneration due to abort signal`)
        return await this.landRegeneration(node, { status: "OUTDATED" })
      }

      const output = nodeProcessor.getOutput(this, { ...node, ...patch })
      const status = outcomeStatus(patch.status, output)

      if (SettingsRepository.getAutoGenerateSummary() && patch.summary === undefined) {
        if (status === "GENERATED") {
          try {
            patch = {
              ...patch,
              summary: (await generateSummary(context.abortSignal, ["plan-node-summary", `${nodeId}`], output)) || "",
            }
          } catch (e) {
            console.error(e)
            patch = { ...patch, summary: `(error): ${e}` }
          }
        } else {
          patch = { ...patch, summary: null }
        }
      } else {
        patch = { ...patch, summary: patch.summary || null }
      }
      // Counted from the output: a loop's element or a node reading earlier
      // iterations produces text without writing content.
      patch = { ...patch, status, ...this.countsOfOutput(output) }

      if (context.abortSignal.aborted) {
        console.warn("[PlanNodeService]", "regenerate", `Stop node ${nodeId} regeneration due to abort signal`)
        return await this.landRegeneration(node, { status: "OUTDATED" })
      }

      return await this.landRegeneration(node, patch)
    } catch (e) {
      console.error(`Unable to regenerate node ${nodeId} at "${path}"`, e)
      // A stopped node is left to be redone, not marked broken.
      await this.landRegeneration(node, { status: context.abortSignal.aborted ? "OUTDATED" : "ERROR" })
      throw e
    }
  }

  /**
   * Writes what a regeneration produced — unless the row changed while it ran.
   * A demotion, a prompt edit or the user's own text all give the row a new
   * revision; the result was built on what the row used to be, so it is
   * dropped and the row keeps the newer write.
   */
  private async landRegeneration(started: PlanNodeRow, outcome: PlanNodeStateUpdate): Promise<PlanNodeRow> {
    const landed = await this.patchState(started.id, started.path, false, outcome, started.rev)
    if (landed) return landed
    console.warn(
      `[PlanNodeService] node ${started.id} at "${started.path}" changed while it was regenerated; result dropped`,
    )
    if (!this.repo.findById(started.id)) {
      throw makeErrorWithStatus(`Plan node ${started.id} was deleted while it was being regenerated`, 404)
    }
    return this.getRow(started.id, started.path)
  }

  // ─── Editor actions ──────────────────────────────────────────────────────────

  /** Starts a review of the node's text at `path`, optionally replacing it. */
  async startReview(id: number, path: NodePath, patch?: PlanNodeStateUpdate): Promise<PlanNodeRow> {
    this.checkPath(id, path)
    return (await this.patchState(id, path, true, { ...pick(patch ?? {}, PLAN_NODE_STATE_KEYS), in_review: 1 }))!
  }

  /** Accepts the review at `path`, clearing its state. */
  async acceptReview(id: number, path: NodePath): Promise<PlanNodeRow> {
    this.checkPath(id, path)
    return (await this.patchState(id, path, true, { in_review: 0, review_base_content: null }))!
  }

  /** Regenerates the node at `path` and opens a review of the change. */
  async regenerateForReview(
    id: number,
    path: NodePath,
    regenerate: (target: { nodeId: number; path: NodePath }) => Promise<PlanNodeRow>,
  ): Promise<PlanNodeRow> {
    this.checkPath(id, path)
    const before = this.getRow(id, path)
    const regenerated = await regenerate({ nodeId: id, path })
    return (await this.patchState(id, path, false, {
      in_review: (regenerated.content?.trim()?.length || 0) > 0 ? 1 : 0,
      review_base_content: before.content,
    }))!
  }

  async aiGenerateSummary(nodeId: number, path: NodePath): Promise<PlanNodeRow> {
    this.checkPath(nodeId, path)
    const node = this.getRow(nodeId, path)
    const output = this.getProcessor(node.type).getOutput(this, node)
    return (await this.patchState(nodeId, path, false, {
      summary: output
        ? await generateSummary(new AbortController().signal, ["plan-node-summary", `${nodeId}`], output)
        : "",
    }))!
  }

  aiImprove(nodeId: number, path: NodePath): Observable<DataOrEventEvent<PlanNodeRow, ResponseStreamEvent>, unknown> {
    this.checkPath(nodeId, path)
    const node = this.getRow(nodeId, path)
    return toObservable<DataOrEventEvent<PlanNodeRow, ResponseStreamEvent>>(async (emit) => {
      const newContent = await improvePlanNodeContent(new AbortController().signal, node, (event) => {
        emit.next({ type: "event", event })
      })
      // The improvement rewrites the text it was given; if that text changed
      // meanwhile, writing it back would throw the newer text away.
      const newNode =
        node.status === "GENERATING"
          ? null
          : await this.patchState(
              nodeId,
              path,
              true,
              {
                status: "MANUAL",
                content: newContent,
                in_review: (node.content?.trim?.()?.length || 0) > 0 ? 1 : 0,
                review_base_content: node.content,
              },
              node.rev,
            )
      if (!newNode) {
        throw makeErrorWithStatus("The node changed while it was being improved; the improvement was discarded", 409)
      }
      emit.next({ type: "data", data: newNode })
      emit.next({ type: "completed" })
    })
  }

  async saveContentToFile(nodeId: number, path: NodePath, filePath: string): Promise<void> {
    await fs.writeFile(filePath, this.getRow(nodeId, path).content || "", "utf8")
  }

  // ─── Counts ──────────────────────────────────────────────────────────────────

  /**
   * Counts of what a node outputs. For split, fix-problems and loops the
   * content is JSON, and counting it would measure the envelope.
   */
  private countsOf(node: PlanNodeRow): Pick<PlanNodeState, "word_count" | "char_count" | "byte_count"> {
    try {
      return this.countsOfOutput(this.getProcessor(node.type).getOutput(this, node))
    } catch {
      // No output yet (a loop before its children exist): count the raw content.
      return this.countsOfOutput(node.content ?? "")
    }
  }

  private countsOfOutput(output: unknown): Pick<PlanNodeState, "word_count" | "char_count" | "byte_count"> {
    const text =
      typeof output === "string"
        ? output
        : Array.isArray(output)
          ? output.filter((part) => typeof part === "string").join("\n\n")
          : ""
    const trimmed = text.trim()
    return {
      word_count: trimmed === "" ? 0 : trimmed.split(/\s+/).length,
      char_count: [...text].length,
      byte_count: Buffer.byteLength(text, "utf8"),
    }
  }
}
