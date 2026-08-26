# Ollama adapter — local models

*Added 2026-08-25; num_ctx guard and sizing added 2026-08-26.*

## What it is

Third engine next to Grok and Yandex: models running on the user's own machine
via the Ollama daemon. No API key, no per-token billing, no text leaving the box.

- `src/backend/ai/ollama-client.ts` — native `/api/chat` over `node:http`, NDJSON stream.
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

## The `num_ctx` trap — it has two faces

**One: the window is smaller than you think.** Ollama gives a model its default
context window (commonly 4096) no matter what the model can hold, and quietly
drops whatever does not fit. So `num_ctx` is a first-class engine setting with a
default of 32768; `/api/tags` reports `details.context_length` per model.

**Two, and far worse: `num_ctx` only applies when Ollama LOADS the model.** If
the model is already resident — pulled in by an earlier request, or by another
consumer sharing the daemon — the window it came up with silently wins and your
setting is ignored. Nothing in the response says so.

And the failure is not truncation. A prompt that outgrows the resident window
makes the daemon **stop answering**: no error, no partial output, just silence
until the idle timeout fires half an hour later. Three full runs died this way
at the same node before the cause was found, and the prompt was over the window
by 88 tokens — 8280 against a resident 8192. One percent over is enough.

Hence the guard: `fetchLoadedModels()` asks `/api/ps` what the resident window
really is, and `describeContextWindowMismatch()` refuses the call when it is
smaller than requested. `/api/ps` reports `context_length` per loaded model —
**check that, never the setting you sent.** A daemon that will not answer
`/api/ps` is no reason to refuse work, so the guard degrades to silence.

Recovery when it happens: `ollama stop <model>`, or reboot. A per-request
`keep_alive` does not necessarily help — a server-side `OLLAMA_KEEP_ALIVE` caps
it, and on this machine both `"24h"` and `-1` came back as 30 min.

## Sizing a window, measured

On `qwen3.8-abliterated:27b-q3_K`, 14.8 GB VRAM:

| Window | Model size | In VRAM | Note |
|---|---|---|---|
| 8192 | 12.5 GB | all of it | fits, but too small for this template |
| 65536 | 16.4 GB | 10.0 GB | 6.4 GB on CPU — still 17.2 tok/s |

Russian tokenises at **~3.5 chars per token** here, so a 48 KB prompt is ~13.6 k
tokens, not the 20 k+ a 2.5 ratio would predict. Budget prompt + `num_predict`
together: the heaviest fiction-arc node needs ~24 k in and 6 k out, so 32768 is
tight and 65536 is right — the CPU offload costs less than the stall it prevents.

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

## Tests

`src/backend/ai/ollama-client.test.ts` — 30 cases over the pure functions:
message assembly (blank system prompt omitted, empty user prompt allowed),
`options` mapping including `max_output_tokens → num_predict` and rejection of
zero / negative / NaN / string values, schema passthrough and `enforceSchema:false`,
`think` handling, NDJSON framing in `takeLines` (partial tail retained, blank lines
dropped, empty buffer safe), and `describeContextWindowMismatch` — silent when the
model is absent, when the daemon reports no window, and when the resident window is
equal or larger; naming both numbers when it is smaller.

`src/backend/ai/ollama-client.timeout.test.ts` — 9 cases against a real `http.Server`:
the transport surviving a long silence before the first header, and `fetchLoadedModels`
parsing `/api/ps` (populated, empty, `models` key missing, trailing slash in base url).

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
