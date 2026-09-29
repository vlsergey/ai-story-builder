import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { ForEachNodeContent } from "../../../shared/for-each-plan-node.js"
import type { PlanEdgeType } from "../../../shared/plan-edge-types.js"
import type { PlanNodeRow, PlanNodeStatus } from "../../../shared/plan-graph.js"
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
import { ForEachProcessor } from "../nodes/graph/for-each-processor.js"
import { PlanNodeRepository } from "../nodes/plan-node-repository.js"
import { PlanNodeService } from "../nodes/plan-node-service.js"
import { type FakeCall, type FakeCallKind, fakeEngine } from "./fake-engine.js"

/**
 * Scenario tests drive a project the way a user does — build a graph, run it,
 * edit something, run again — and observe what a user would: which nodes the
 * model was asked to write, what they now say, their statuses. They never read
 * how state is stored; the one place that knows is `stateAt` below, so a change
 * of storage rewrites this driver, not the scenarios.
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

function rowByTitle(title: string): PlanNodeRow {
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
    return await this.observe(() => regenerateTreeNodesContents(nodeId(title)))
  }

  /** The Stop button. */
  stop(): void {
    stop()
  }

  /** The user types `content` into the node. */
  async type(title: string, content: string): Promise<void> {
    await new PlanNodeService().patch(nodeId(title), true, { content })
  }

  /** The user rewrites the node's prompt. */
  async setPrompt(title: string, prompt: string): Promise<void> {
    const row = rowByTitle(title)
    const settings = JSON.parse(row.node_type_settings || "{}") as Record<string, unknown>
    await new PlanNodeService().patch(row.id, true, {
      node_type_settings: JSON.stringify({ ...settings, userPrompt: prompt }),
    })
  }

  /** Asks the model to improve the node's text; resolves with the error, if any. */
  async improve(title: string, instruction: string): Promise<{ error?: unknown }> {
    const id = nodeId(title)
    await new PlanNodeService().patch(id, true, { ai_improve_instruction: instruction })
    this.since = this.engine.calls.length
    return await new Promise((resolve) => {
      new PlanNodeService().aiImprove(id).subscribe({
        next: () => {},
        error: (error) => resolve({ error }),
        complete: () => resolve({}),
      })
    })
  }

  /** The editor's "Generate summary" button. */
  async summarize(title: string): Promise<void> {
    this.since = this.engine.calls.length
    await new PlanNodeService().aiGenerateSummary(nodeId(title))
  }

  /** Starts a review of the node, as the editor's review mode does. */
  async startReview(title: string): Promise<void> {
    await new PlanNodeService().startReview(nodeId(title))
  }

  /** The user pages a loop to `iteration`. */
  show(loop: string, iteration: number): void {
    new PlanNodeService().changeForEachNodePage(nodeId(loop), iteration)
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

  /** Every node's status; a loop's child once per iteration, titled `Title #i`. */
  nodes(): { title: string; status: PlanNodeStatus }[] {
    const all = new PlanNodeRepository().findAll()
    return all.flatMap((node) => {
      const parent = all.find((p) => p.id === node.parent_id)
      if (parent?.type !== "for-each") return [{ title: node.title, status: node.status }]
      const length = (JSON.parse(parent.content || "{}") as ForEachNodeContent).length ?? 0
      return Array.from({ length }, (_, i) => ({ title: `${node.title} #${i}`, status: this.status(node.title, i) }))
    })
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

  /** What the loop hands to the nodes after it: one output per element. */
  loopResults(loop: string): string[] {
    return new ForEachProcessor().getOutput(new PlanNodeService(), rowByTitle(loop))
  }

  /**
   * The node's state in one iteration of its loop. The only place that knows
   * how iterations are stored: the iteration on display lives in the rows, the
   * others in the loop's snapshots.
   */
  private stateAt(
    title: string,
    iteration?: number,
  ): { content: string | null; status: PlanNodeStatus; in_review: number; word_count: number } {
    const row = rowByTitle(title)
    if (iteration === undefined) return row
    const loop = row.parent_id === null ? undefined : new PlanNodeRepository().findById(row.parent_id)
    if (loop?.type !== "for-each") throw new Error(`«${title}» is not inside a loop`)
    const parsed = JSON.parse(loop.content || "{}") as ForEachNodeContent
    if (iteration === (parsed.currentIndex ?? 0)) return row
    const entry = parsed.overrides?.[iteration]?.[`${row.id}`]
    if (!entry) return { content: null, status: "OUTDATED", in_review: 0, word_count: 0 }
    return {
      content: entry.content ?? null,
      status: (entry.status ?? "EMPTY") as PlanNodeStatus,
      // Review fields are not snapshotted: the row's are the only ones there are.
      in_review: row.in_review,
      word_count: entry.word_count ?? 0,
    }
  }

  /** The last status event of the last run: counters, first error. */
  get lastStatus(): RegenerateStatusEvent | undefined {
    return this.statusEvents.at(-1)
  }

  /** Titles of the nodes the progress panel showed as being written during the last run. */
  shownInProgress(): string[] {
    const titles = this.statusEvents.flatMap((event) =>
      event.currentRegenerationStack.flatMap((item) => (item.type === "node" ? [item.node.title] : [])),
    )
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
