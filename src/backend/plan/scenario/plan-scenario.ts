import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { iterationKeys, LOOP_TYPES } from "../../../shared/loop-iterations.js"
import type { PlanEdgeType } from "../../../shared/plan-edge-types.js"
import type { PlanNodeDefinition, PlanNodeRow, PlanNodeStatus } from "../../../shared/plan-graph.js"
import {
  childPath,
  lastSegment,
  type NodePath,
  parentPath,
  parsePath,
  ROOT_PATH,
} from "../../../shared/plan-node-path.js"
import type { PlanNodeType } from "../../../shared/plan-node-types.js"
import type { ProjectTemplate } from "../../../shared/project-template.js"
import type { RegenerateStatusEvent } from "../../../shared/RegenerateEvent.js"
import { setUpTestDb } from "../../db/test-db-utils.js"
import { applyProjectTemplate } from "../../projects/apply-project-template.js"
import { SettingsRepository } from "../../settings/settings-repository.js"
import { PlanEdgeRepository } from "../edges/plan-edge-repository.js"
import {
  regenerateTreeNodesContents,
  stop,
  subscribeToStatusEvents,
} from "../nodes/generate/regenerateTreeNodesContents.js"
import { PlanNodeRepository } from "../nodes/plan-node-repository.js"
import { PlanNodeService } from "../nodes/plan-node-service.js"
import { type FakeCall, type FakeCallKind, fakeEngine } from "./fake-engine.js"

/**
 * Scenario tests drive a project the way a user does — build a graph, run it,
 * edit something, run again — and observe what a user would: which nodes the
 * model was asked to write, what they now say, their statuses. They never read
 * how state is stored; the one place that knows is `stateAt` below, so a change
 * of storage rewrites this driver, not the scenarios. Like the user, the driver
 * looks at a loop's children in the iteration on display — the first one until
 * `show` pages it.
 *
 * Every scenario test file installs the fake engine:
 *   vi.mock("../../ai/ai-engine-adapter.js", async () => (await import("./fake-engine.js")).fakeEngineAdapterModule)
 */

const TEMPLATES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../resources/resources/templates")

const LIST_TYPES: ReadonlySet<PlanNodeType> = new Set(["split", "for-each", "for-each-prev-outputs"])

interface Prompted {
  prompt: string
  system?: string
}

/** Builds a plan graph by title; edges into generated nodes follow the inputs their prompts name. */
export class GraphBuilder {
  constructor(protected readonly parentId: number | null) {}

  /** A text the user wrote; nothing generates it. */
  source(title: string, content: string): void {
    new PlanNodeService().create({ title, type: "text", parent_id: this.parentId, content })
  }

  /** A text node written by the model from its prompt. */
  text(title: string, spec: Prompted): void {
    this.add(title, "text", { userPrompt: spec.prompt, systemPrompt: spec.system })
    this.wireFromPrompts(title, [spec.prompt, spec.system])
  }

  /** A list the model makes from its prompt. */
  split(title: string, spec: Prompted): void {
    this.add(title, "split", { userPrompt: spec.prompt, systemPrompt: spec.system })
    this.wireFromPrompts(title, [spec.prompt, spec.system])
  }

  /** Joins its inputs, in order. */
  merge(title: string, from: string[]): void {
    this.add(title, "merge", {})
    for (const source of from) this.edge(source, title)
  }

  /** Renders its inputs through a Handlebars layout. */
  format(title: string, template: string, from: string[]): void {
    this.add(title, "format", { template })
    for (const source of from) this.edge(source, title)
  }

  /** Reviews `fix` with the `find` prompt and rewrites it with `fixWith` while problems remain. */
  fixProblems(
    title: string,
    spec: { fix: string; find: string; fixWith: string; maxIterations?: number; minSeverity?: number },
  ): void {
    this.add(title, "fix-problems", {
      sourceNodeIdToFix: nodeId(spec.fix),
      aiUserInstructionsToFindProblems: spec.find,
      aiUserInstructionsToFixProblems: spec.fixWith,
      foundProblemsTemplate: "Найденные проблемы",
      maxIterations: spec.maxIterations ?? 2,
      minSeverityToFix: spec.minSeverity ?? 50,
    })
    this.edge(spec.fix, title, "text")
    this.wireFromPrompts(title, [spec.find, spec.fixWith])
  }

  /** An input edge the consumer's prompt does not necessarily name. */
  connect(from: string, to: string): void {
    this.edge(from, to)
  }

  /**
   * A for-each over the list `over`. Inside, `element` holds the current
   * element and whatever is wired into `result` becomes that iteration's output.
   */
  loop(title: string, spec: { over: string; element: string; result: string }, body: (b: LoopBuilder) => void): void {
    const service = new PlanNodeService()
    const repo = new PlanNodeRepository()
    const { id } = service.create({ title, type: "for-each", parent_id: this.parentId })
    repo.patch(repo.findByParentIdAndType(id, "for-each-input")[0].id, { title: spec.element })
    repo.patch(repo.findByParentIdAndType(id, "for-each-output")[0].id, { title: spec.result })
    this.edge(spec.over, title, "textArray")
    body(new LoopBuilder(id, spec.result))
  }

  /** Adds to a loop that already exists. */
  inside(loop: string): LoopBuilder {
    const id = nodeId(loop)
    const output = new PlanNodeRepository().findByParentIdAndType(id, "for-each-output")[0]
    return new LoopBuilder(id, output.title)
  }

  protected add(title: string, type: PlanNodeType, settings: Record<string, unknown>): void {
    new PlanNodeService().create({
      title,
      type,
      parent_id: this.parentId,
      node_type_settings: JSON.stringify(settings),
    })
  }

  protected edge(from: string, to: string, type?: PlanEdgeType): void {
    const source = rowByTitle(from)
    new PlanEdgeRepository().insert({
      from_node_id: source.id,
      to_node_id: nodeId(to),
      type: type ?? (LIST_TYPES.has(source.type) ? "textArray" : "text"),
    })
  }

  private wireFromPrompts(title: string, templates: (string | undefined)[]): void {
    // Wired from the prompt text itself, not from `templateVariables`: the
    // relevance rule under test must not decide which edges a scenario has.
    const text = templates.filter(Boolean).join("\n")
    for (const node of new PlanNodeRepository().findAll()) {
      if (node.title === title) continue
      if (text.includes(`[${node.title}]`) || text.includes(`{{${node.title}}}`)) this.edge(node.title, title, "text")
    }
  }
}

export class LoopBuilder extends GraphBuilder {
  constructor(
    loopId: number,
    private readonly resultTitle: string,
  ) {
    super(loopId)
  }

  /** Makes `title` this iteration's output. */
  result(title: string): void {
    this.edge(title, this.resultTitle, "text")
  }

  /** The outputs of the iterations before this one — a sequential loop's memory. */
  previousResults(title: string): void {
    new PlanNodeService().create({ title, type: "for-each-prev-outputs", parent_id: this.parentId })
  }
}

function rowByTitle(title: string): PlanNodeDefinition {
  const matches = new PlanNodeRepository().findAll().filter((n) => n.title === title)
  if (matches.length !== 1) throw new Error(`expected one node titled «${title}», found ${matches.length}`)
  return matches[0]
}

function nodeId(title: string): number {
  return rowByTitle(title).id
}

export interface ScenarioOptions {
  /** Summaries after every generation; off unless a scenario is about them. */
  autoSummary?: boolean
}

export class PlanScenario {
  readonly engine = fakeEngine
  /** Every status event of the last run, as the progress panel receives them. */
  statusEvents: RegenerateStatusEvent[] = []
  private since = 0
  /** The iteration on display, per loop; the first one until the user pages. */
  private readonly displayed = new Map<number, number>()

  private constructor() {}

  static build(define: (g: GraphBuilder) => void, options: ScenarioOptions = {}): PlanScenario {
    const scenario = PlanScenario.open(options)
    define(new GraphBuilder(null))
    return scenario
  }

  static async fromTemplate(
    file: string,
    wizard: Record<string, unknown>,
    options: ScenarioOptions = {},
  ): Promise<PlanScenario> {
    const scenario = PlanScenario.open(options)
    const template = JSON.parse(await fs.readFile(path.join(TEMPLATES_DIR, file), "utf8")) as ProjectTemplate
    applyProjectTemplate(template, wizard)
    return scenario
  }

  private static open(options: ScenarioOptions): PlanScenario {
    setUpTestDb()
    fakeEngine.reset()
    SettingsRepository.setCurrentBackend("grok")
    SettingsRepository.setAllAiEnginesConfig({
      grok: {
        api_key: "fake",
        defaultAiGenerationSettings: { model: "fake" },
        generateSummaryInstructions: "Кратко перескажи:",
      },
    })
    SettingsRepository.setAutoGenerateSummary(options.autoSummary ?? false)
    SettingsRepository.setAiRegenerateGenerated(false)
    SettingsRepository.setAiRegenerateManual(false)
    return new PlanScenario()
  }

  // ─── What the user does ────────────────────────────────────────────────────

  /** Adds nodes to the project, as the user does in the graph. */
  extend(define: (g: GraphBuilder) => void): void {
    define(new GraphBuilder(null))
  }

  /** Runs the whole project, as the Regenerate button does. */
  async run(): Promise<void> {
    await this.observe(() => regenerateTreeNodesContents())
  }

  /** Regenerates one node from its editor. */
  async regenerate(title: string): Promise<PlanNodeRow> {
    const id = nodeId(title)
    return await this.observe(() => regenerateTreeNodesContents({ nodeId: id, path: this.displayPath(id) }))
  }

  /** The Stop button. */
  stop(): void {
    stop()
  }

  /** The user types `content` into the node. */
  async type(title: string, content: string): Promise<void> {
    const id = nodeId(title)
    await new PlanNodeService().patch(id, this.displayPath(id), true, { content })
  }

  /** The user rewrites the node's prompt. */
  async setPrompt(title: string, prompt: string): Promise<void> {
    const row = rowByTitle(title)
    const settings = JSON.parse(row.node_type_settings || "{}") as Record<string, unknown>
    await new PlanNodeService().patch(row.id, this.displayPath(row.id), true, {
      node_type_settings: JSON.stringify({ ...settings, userPrompt: prompt }),
    })
  }

  /** The user types an instruction for improving the node, without running it yet. */
  async noteImprovement(title: string, instruction: string): Promise<void> {
    const id = nodeId(title)
    await new PlanNodeService().patch(id, this.displayPath(id), true, { ai_improve_instruction: instruction })
  }

  /** The user deletes the node. */
  remove(title: string): void {
    new PlanNodeService().delete(nodeId(title))
  }

  /** The user moves the node into `parent`, or out to the top level. */
  async move(title: string, parent: string | null): Promise<void> {
    await new PlanNodeService().patchDefinition(nodeId(title), { parent_id: parent === null ? null : nodeId(parent) })
  }

  /** Asks the model to improve the node's text; resolves with the error, if any. */
  async improve(title: string, instruction: string): Promise<{ error?: unknown }> {
    const id = nodeId(title)
    const path = this.displayPath(id)
    await new PlanNodeService().patch(id, path, true, { ai_improve_instruction: instruction })
    this.since = this.engine.calls.length
    return await new Promise((resolve) => {
      new PlanNodeService().aiImprove(id, path).subscribe({
        next: () => {},
        error: (error) => resolve({ error }),
        complete: () => resolve({}),
      })
    })
  }

  /** The editor's "Generate summary" button. */
  async summarize(title: string): Promise<void> {
    this.since = this.engine.calls.length
    await this.summarizeMeanwhile(title)
  }

  /** The summary button, pressed while something else runs: the call log stays that run's. */
  async summarizeMeanwhile(title: string): Promise<void> {
    const id = nodeId(title)
    await new PlanNodeService().aiGenerateSummary(id, this.displayPath(id))
  }

  summary(title: string, iteration?: number): string | null {
    return this.stateAt(title, iteration).summary
  }

  /** Starts a review of the node, as the editor's review mode does. */
  async startReview(title: string): Promise<void> {
    const id = nodeId(title)
    await new PlanNodeService().startReview(id, this.displayPath(id))
  }

  /** The user pages a loop to `iteration`. */
  show(loop: string, iteration: number): void {
    this.displayed.set(nodeId(loop), iteration)
  }

  /** How many calls the engine takes at once, as set in its settings. */
  setEngineConcurrency(calls: number): void {
    const config = SettingsRepository.getAllAiEnginesConfig()
    SettingsRepository.setAllAiEnginesConfig({ ...config, grok: { ...config.grok, max_concurrent_calls: calls } })
  }

  /** The regeneration switches of the Regenerate panel. */
  setRegenerate(options: { generated?: boolean; manual?: boolean }): void {
    if (options.generated !== undefined) SettingsRepository.setAiRegenerateGenerated(options.generated)
    if (options.manual !== undefined) SettingsRepository.setAiRegenerateManual(options.manual)
  }

  // ─── What the user sees ────────────────────────────────────────────────────

  /** Calls since the last run or improve started, optionally of one kind. */
  calls(kind?: FakeCallKind): FakeCall[] {
    const recent = this.engine.calls.slice(this.since)
    return kind ? recent.filter((c) => c.kind === kind) : recent
  }

  /** Titles of the nodes the model wrote since the last run started, each once, in call order. */
  generated(): string[] {
    const writing = new Set<FakeCallKind>(["text", "split", "fix-problems", "find-problems"])
    return [
      ...new Set(
        this.calls()
          .filter((c) => writing.has(c.kind))
          .map((c) => c.node),
      ),
    ]
  }

  content(title: string, iteration?: number): string | null {
    return this.stateAt(title, iteration).content
  }

  status(title: string, iteration?: number): PlanNodeStatus {
    return this.stateAt(title, iteration).status
  }

  wordCount(title: string, iteration?: number): number {
    return this.stateAt(title, iteration).word_count
  }

  inReview(title: string, iteration?: number): boolean {
    return this.stateAt(title, iteration).in_review === 1
  }

  /**
   * Every node's status; a loop's child once per iteration its loop has,
   * titled `Title #i`, or `Title #i/#j` inside a nested loop.
   */
  nodes(): { title: string; status: PlanNodeStatus }[] {
    const service = new PlanNodeService()
    const result: { title: string; status: PlanNodeStatus }[] = []
    const visit = (parentId: number | null, paths: NodePath[]) => {
      for (const node of service.findByParentId(parentId)) {
        for (const path of paths) {
          const iterations = path === ROOT_PATH ? "" : ` #${path.replace(/\d+:/g, "").split("/").join("/#")}`
          result.push({ title: `${node.title}${iterations}`, status: service.getRow(node.id, path).status })
        }
        const inner = LOOP_TYPES.has(node.type)
          ? paths.flatMap((path) =>
              iterationKeys(node.type, service.getRow(node.id, path).content).map((key) =>
                childPath(path, node.id, key),
              ),
            )
          : paths
        visit(node.id, inner)
      }
    }
    visit(null, [ROOT_PATH])
    return result
  }

  /**
   * Titles of the nodes a change of `title` can reach: along edges, into a
   * loop's element, out through its result, and on to later iterations.
   */
  reachableFrom(title: string): Set<string> {
    const nodes = new PlanNodeRepository().findAll()
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const next = new Map<number, number[]>()
    const link = (from: number, to: number) => next.set(from, [...(next.get(from) ?? []), to])
    for (const edge of new PlanEdgeRepository().findAll()) link(edge.from_node_id, edge.to_node_id)
    for (const loop of nodes.filter((n) => n.type === "for-each")) {
      const children = nodes.filter((n) => n.parent_id === loop.id)
      for (const child of children) {
        if (child.type === "for-each-input") link(loop.id, child.id)
        if (child.type !== "for-each-output") continue
        link(child.id, loop.id)
        for (const previous of children.filter((c) => c.type === "for-each-prev-outputs")) link(child.id, previous.id)
      }
    }
    const start = nodeId(title)
    const seen = new Set<number>([start])
    const queue = [start]
    while (queue.length > 0) {
      for (const to of next.get(queue.shift() as number) ?? []) {
        if (seen.has(to)) continue
        seen.add(to)
        queue.push(to)
      }
    }
    seen.delete(start)
    return new Set([...seen].map((id) => byId.get(id)?.title ?? `#${id}`))
  }

  /** What the loop, in the iteration on display, hands to the nodes after it: one output per element. */
  loopResults(loop: string): string[] {
    const id = nodeId(loop)
    const service = new PlanNodeService()
    const row = service.getRow(id, this.displayPath(id))
    return service.getProcessor(row.type).getOutput(service, row) as string[]
  }

  /** Where the user looks at the node: in every loop around it, the iteration on display. */
  private displayPath(id: number): NodePath {
    const service = new PlanNodeService()
    let path = ROOT_PATH
    for (const loop of service.loopsAround(id)) path = this.iterationPath(loop, path, this.displayed.get(loop) ?? 0)
    return path
  }

  /** The path of the loop's iteration at `position`, the way the user counts them. */
  private iterationPath(loop: number, loopPath: NodePath, position: number): NodePath {
    const row = new PlanNodeService().getRow(loop, loopPath)
    const keys = iterationKeys(row.type, row.content)
    return childPath(loopPath, loop, keys[position] ?? String(position))
  }

  /**
   * The node's state in one iteration of its loop, or in the one on display.
   * The only place that knows how iterations are stored: each has its own row.
   */
  private stateAt(
    title: string,
    iteration?: number,
  ): { content: string | null; summary: string | null; status: PlanNodeStatus; in_review: number; word_count: number } {
    const id = nodeId(title)
    let path = this.displayPath(id)
    if (iteration !== undefined) {
      const loop = lastSegment(path)?.containerId
      if (loop === undefined) throw new Error(`«${title}» is not inside a loop`)
      path = this.iterationPath(loop, parentPath(path), iteration)
    }
    return new PlanNodeService().getRow(id, path)
  }

  /** The last status event of the last run: counters, first error. */
  get lastStatus(): RegenerateStatusEvent | undefined {
    return this.statusEvents.at(-1)
  }

  /** Where the last run failed, as the progress panel names it: the node, and its iteration in each loop. */
  failure(): { node: string; iterations: number[] } | undefined {
    const at = this.lastStatus?.firstErrorAt
    if (!at) return undefined
    return { node: at.title, iterations: parsePath(at.path).map((segment) => Number(segment.key)) }
  }

  /** Titles of the nodes the progress panel showed as being written during the last run. */
  shownInProgress(): string[] {
    const titles = this.statusEvents.flatMap((event) => event.running.map(({ node }) => node.title))
    return [...new Set(titles)]
  }

  private async observe<T>(action: () => Promise<T>): Promise<T> {
    this.since = this.engine.calls.length
    this.statusEvents = []
    // Kept and read later, the way the progress panel gets them across IPC.
    const subscription = subscribeToStatusEvents().subscribe({
      next: (event) => {
        this.statusEvents.push(event)
      },
    })
    try {
      return await action()
    } finally {
      subscription.unsubscribe()
    }
  }
}
