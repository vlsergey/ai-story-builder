# Ollama adapter — local models

*Added 2026-08-25.*

## What it is

Third engine next to Grok and Yandex: models running on the user's own machine
via the Ollama daemon. No API key, no per-token billing, no text leaving the box.

- `src/backend/ai/ollama-client.ts` — native `/api/chat` over `fetch`, NDJSON stream.
- `src/backend/ai/ollama-adapter.ts` — `AiEngineAdapter` implementation.
- `src/shared/ollama-ai-generation-settings.ts`, `OLLAMA_ENGINE_DEF` in
  `src/shared/ai-engines.ts`, `OllamaEngineConfig` in `src/shared/ai-engine-config.ts`.
- Registered in `adapters` (`ai-engine-adapter.ts`); i18n in `ai-engines-i18n.{ru,en}.json`.

## Native `/api/chat`, not the OpenAI-compatible `/v1`

Ollama exposes both. The native endpoint was chosen because:

- `format` takes a **JSON Schema object** directly, which is what
  `GenerateResponseRequest.responseSchema` already carries. The `/v1` route
  needs the OpenAI `response_format` wrapper and honours it less reliably.
- `options.num_ctx` is reachable. Through `/v1` it is not — see the trap below.
- `think: false` turns off the reasoning channel on models that have one.

Cost: the app's `onEvent` contract speaks `OpenAI.Responses.ResponseStreamEvent`,
so the adapter synthesises the two events anything downstream actually consumes:
`response.output_text.delta` per chunk and one `response.completed` carrying usage.
Yandex gets these free from the OpenAI SDK; here they are hand-built.

## The `num_ctx` trap

**Ollama silently truncates the prompt to the model's default context window**
(commonly 4096 tokens) no matter what the model can hold. There is no error and
no warning — the head of the prompt is simply gone, and the model answers from
whatever survived. A 38 KB template prompt loses most of itself this way.

`num_ctx` is therefore a first-class engine setting with a default of 32768 and a
hint that says so. Set it to the model's real window; `/api/tags` reports
`details.context_length` per model.

## What local models don't have

`web_search`, file upload, knowledge bases and provider-reported cost are absent
from `OLLAMA_ENGINE_DEF.capabilities` rather than stubbed. Usage **counts** are
reported (`prompt_eval_count` / `eval_count` → `input_tokens` / `output_tokens`)
so the telemetry pane still shows volume; cost stays absent rather than invented.

Age rating is `NC21` — not a claim about permissiveness but an admission that no
provider policy applies: what a locally pulled model will write is decided by that
model.

## Model choice matters more than the adapter

Measured on the same prompt, same settings, Russian prose out:

| Model | Time | Result |
|---|---|---|
| `huihui_ai/qwen3.5-abliterated:9b` | ~13 s | a Chinese token mid-sentence (`сердце猛地 подпрыгнуть`) |
| `huihui_ai/qwen3.8-abliterated:27b-q3_K` | ~5 s | clean, no CJK |

The 27B is both faster here and clean, so prefer it. Do not read the 9B result as
"local models leak scripts into Russian" — it is that build, not the class.

Prose *quality* was not measured and is not claimed. In the same probe the 27B
opened with "she felt it not by hearing but with her back" — against a prompt that
said she hears the lock click. Fluent, and contradicting the brief in its first
clause. That failure mode is invisible to a reading eye and is what the template's
checks exist for; do not substitute an impression of the output for them.

`/api/tags` reports `details.context_length` per model; use it to set `num_ctx`.

## Tests

`src/backend/ai/ollama-client.test.ts` — 22 cases over the two pure functions:
message assembly (blank system prompt omitted, empty user prompt allowed),
`options` mapping including `max_output_tokens → num_predict` and rejection of
zero / negative / NaN / string values, schema passthrough and `enforceSchema:false`,
`think` handling, and NDJSON framing in `takeLines` (partial tail retained, blank
lines dropped, empty buffer safe).

Live check against a running daemon is not in the suite — it needs the model
pulled. Reproduce with a short script importing `streamOllamaChat` directly.

## Always cap `max_output_tokens` on local models

First full-template run (40 nodes, 3 chunks, 27B) reached node 37 of 40 in ~2 h and
died in a `fix-problems` node with:

```
Unterminated string in JSON at position 144085
```

The node had been running for 69 minutes. Cause: `max_output_tokens: 0` in the
engine settings, i.e. no `num_predict` sent, i.e. no stop.

**A JSON schema in `format` buys shape, not termination.** Grammar-constrained
decoding guarantees the output parses — but the grammar happily allows an
arbitrarily long string and an arbitrarily large array, so a model that starts
enumerating findings can run until it exhausts the context, at which point the
JSON is truncated and unparseable. Hosted models stop on their own; a local one
has no such instinct.

Set `max_output_tokens` to something the node's purpose justifies (a findings list
needs far less than prose). Zero means "no limit" and on a local model that is a
trap, not a convenience.

Everything upstream of that node completed and stayed proportionate: reviews edited
their documents rather than inflating them (world 13 545 → 14 625 chars across two
gates, setting 13 420 → 14 671), the `split` produced exactly the requested three
parts as valid JSON, and the tension-score node came out at 873 chars — one line per
scene, as designed.
