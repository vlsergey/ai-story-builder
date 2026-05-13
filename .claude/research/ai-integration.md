# AI integration: providers, prompt building, streaming

> Last verified: 2026-05-13. Re-check before relying on file paths and line numbers.

## Provider adapter pattern

A single interface — [`AiEngineAdapter<T>`](../../src/backend/ai/ai-engine-adapter.ts#L50-L57) — abstracts away the LLM provider. Two implementations:

- [`YandexAdapter`](../../src/backend/ai/yandex-adapter.ts) — Yandex Cloud Foundation Models.
- [`GrokAdapter`](../../src/backend/ai/grok-adapter.ts) — xAI Grok.

Selection is keyed by `AiEngineKey` (`"grok" | "yandex"`); the registry is a plain object at [`ai-engine-adapter.ts:59-62`](../../src/backend/ai/ai-engine-adapter.ts#L59-L62):

```ts
const adapters = { grok: new GrokAdapter(), yandex: new YandexAdapter() }
```

Both adapters speak the OpenAI Responses API shape internally (they reuse OpenAI's `ResponseStreamEvent` types), which means new providers should be feasible to add as long as they can be wrapped in that event stream.

## Request shape

[`GenerateResponseRequest`](../../src/backend/ai/ai-engine-adapter.ts#L16-L38) fields:

- `userPrompt`, `systemPrompt` — final strings, already template-expanded.
- `abortSignal` — propagated from the regeneration engine, lets the user cancel mid-stream.
- `aiGenerationSettings` — model, temperature, max tokens, web search toggle, etc. Merged from app defaults + project settings + per-node `ai_settings`.
- `engineFileIds` — uploaded attachments (currently lore-related uploads); filtered by `to_be_deleted`.
- `promptCacheKeys` — provider-specific cache routing (lower cost, faster TTFT for repeated prompts).
- `responseSchema` (optional) — JSON Schema for structured output.
- `stringFormat` — when `false`, schema is described in the system prompt rather than enforced at API level. Useful when strict JSON-mode breaks on complex schemas.

`testConnectivity` is the other method — a cheap probe used by the Settings UI to verify credentials.

## Prompt building for plan nodes

Entry point: [`generatePlanNodeTextContent`](../../src/backend/ai/generate-plan-node-text-content.ts). Called by `TextProcessor.regenerate` ([text-processor.ts:62](../../src/backend/plan/nodes/graph/text-processor.ts#L62)).

Substitution mechanic — [`replaceTemplates.ts`](../../src/backend/ai/replaceTemplates.ts):
- Tokens `{{NodeTitle}}` in prompts are replaced with the resolved output of the input node with that title.
- This is **title-based**, not id-based, in the runtime. The plan templates currently use id-based references, which is the divergence we're about to fix.

## Streaming lifecycle

The adapter contract:

```
generateResponse(req, onEvent) → Promise<string>
   onEvent: ResponseStreamEvent → ...
```

Events flow: `onThinking('generating')` → repeated `onDelta(chunk)` → `onThinking('done')`, plus optional `partial_json` events for structured output. The final concatenated string is the resolved value.

In the plan layer, these events are forwarded to the frontend through [`RegenerationContext.onResponseStreamEvent`](../../src/backend/plan/nodes/generate/RegenerationContext.ts) under a route-key path like `["content"]` (for the node's main content stream). The tRPC subscription wraps them as observables.

## Cost tracking

The latest AI generation is buffered in [`last-ai-generation-event-manager.ts`](../../src/backend/ai/last-ai-generation-event-manager.ts) for the AI Billing panel. There used to be an `ai_calls` table; it was dropped in migration 011 because it was never populated.

Per-period totals for Grok are fetched from xAI's billing API in [`routes/ai-billing.ts`](../../src/backend/routes/ai-billing.ts).

## Lore-related AI operations

- `improvePlanNodeContent` ([routes/improve-plan-node-content.ts](../../src/backend/routes/improve-plan-node-content.ts)) — apply an "improvement instruction" to existing content via LLM; sets review-mode for the node.
- `syncLore` ([routes/ai-sync.ts](../../src/backend/routes/ai-sync.ts)) — provider-specific upload of lore documents so they can be attached to future requests (currently in flux; see [`lore.md`](lore.md)).
- `generateSummary` ([ai/generate-summary.ts](../../src/backend/ai/generate-summary.ts)) — cheap secondary call that produces a 1-2 sentence summary of any text output. Toggled by app-level setting.
- `generateFixProblems` ([ai/generate-fix-problems.ts](../../src/backend/ai/generate-fix-problems.ts)) — used by `fix-problems` node type.

## Adding a new provider

If you needed to add (say) Anthropic:
1. Implement `AiEngineAdapter` in a new `claude-adapter.ts`. Translate OpenAI Responses stream events from Anthropic's SSE.
2. Add the key to `AiEngineKey` union ([`src/shared/ai-engines.ts`](../../src/shared/ai-engines.ts)).
3. Register in the `adapters` map.
4. Add per-engine settings type analogous to [`grok-ai-generation-settings.ts`](../../src/shared/grok-ai-generation-settings.ts) and [`yandex-ai-generation-settings.ts`](../../src/shared/yandex-ai-generation-settings.ts).
5. Settings UI updates in `src/frontend/src/settings/`.
