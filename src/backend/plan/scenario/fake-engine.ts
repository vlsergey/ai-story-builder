import { createHash } from "node:crypto"
import type OpenAI from "openai"
import type { AiEngineAdapter, GenerateResponseRequest } from "../../ai/ai-engine-adapter.js"
import { PlanNodeRepository } from "../nodes/plan-node-repository.js"

export type FakeCallKind = "text" | "split" | "find-problems" | "fix-problems" | "summary" | "improve"

/** One request that reached the model. */
export interface FakeCall {
  kind: FakeCallKind
  nodeId: number
  /** The node's title when the call was made. */
  node: string
  userPrompt: string
  systemPrompt: string
  /** What the model answered; unset while the call is in flight or if it failed. */
  response?: string
}

/**
 * Answers a call with a raw model response, or returns `undefined` to leave it
 * to the next handler and finally to the default answer. May also act — edit
 * the project, stop the run — while the call is in flight, or throw to fail it.
 */
export type FakeHandler = (call: FakeCall) => string | undefined | Promise<string | undefined>

/**
 * A deterministic stand-in for the model, installed where the real engines are
 * looked up. Its default answers derive from the rendered prompts: unchanged
 * inputs give the same text, a changed input changes it. That is what lets a
 * scenario tell a needed re-run from a wasted one by the call log alone.
 */
export class FakeEngine implements AiEngineAdapter {
  readonly calls: FakeCall[] = []
  private handlers: FakeHandler[] = []

  reset(): void {
    this.calls.length = 0
    this.handlers = []
  }

  /** Handlers run in the order added; the first to return a string answers. */
  on(handler: FakeHandler): void {
    this.handlers.push(handler)
  }

  async generateResponse(
    req: GenerateResponseRequest,
    onEvent?: (event: OpenAI.Responses.ResponseStreamEvent) => void,
  ): Promise<string> {
    if (req.abortSignal.aborted) throw new Error("This operation was aborted")
    const call = describeCall(req)
    this.calls.push(call)

    let response: string | undefined
    for (const handler of this.handlers) {
      response = await handler(call)
      if (response !== undefined) break
    }
    if (req.abortSignal.aborted) throw new Error("This operation was aborted")

    const text = response ?? defaultResponse(call)
    call.response = text
    onEvent?.({ type: "response.output_text.delta", delta: text } as OpenAI.Responses.ResponseStreamEvent)
    return text
  }

  async testConnectivity(): Promise<{ ok: boolean }> {
    return { ok: true }
  }
}

function describeCall(req: GenerateResponseRequest): FakeCall {
  const [purpose, ...rest] = req.promptCacheKeys
  // Summary keys are ["generate-summary", "plan-node-summary", id]; the others end with the id.
  const nodeId = Number(rest[rest.length - 1])
  const node = new PlanNodeRepository().findById(nodeId)
  let kind: FakeCallKind
  if (purpose === "generate-summary") kind = "summary"
  else if (purpose === "improve-plan-node-content") kind = "improve"
  else if (purpose === "generate-split-parts") kind = "split"
  else if (req.responseSchema?.name === "fixProblemsFoundProblemsSchema") kind = "find-problems"
  else kind = node?.type === "fix-problems" ? "fix-problems" : "text"
  return {
    kind,
    nodeId,
    node: node?.title ?? `#${nodeId}`,
    userPrompt: req.userPrompt ?? "",
    systemPrompt: req.systemPrompt ?? "",
  }
}

function defaultResponse(call: FakeCall): string {
  const digest = createHash("sha256").update(`${call.systemPrompt}\u0000${call.userPrompt}`).digest("hex").slice(0, 8)
  switch (call.kind) {
    case "split":
      // Two parts that change with the input, as a real model's would: an
      // upstream edit re-seeds the loops over this list.
      return JSON.stringify({ parts: [`${call.node} 1 #${digest}`, `${call.node} 2 #${digest}`] })
    case "find-problems":
      return JSON.stringify({ foundProblems: [] })
    default:
      return `${call.kind} of «${call.node}» #${digest}`
  }
}

export const fakeEngine = new FakeEngine()

/** Replaces `ai/ai-engine-adapter.js` in scenario tests. */
export const fakeEngineAdapterModule = { getEngineAdapter: () => fakeEngine }
