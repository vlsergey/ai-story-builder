# `script` node — deterministic text→text steps

*Added 2026-08-25.*

## Why it exists

Some checks are arithmetic, not judgement: repeated n-grams across a corpus, a
tension-curve shape, word budgets, clothing-state greps. An LLM asked to count
4-grams over 30 000 words returns a plausible answer, not a correct one — it
performs the check rather than running it.

Every other node type in the graph is an LLM call. `script` is the one that isn't.

## Shape

- Type registered in `src/schemas/plan-node-types.json` → generated into
  `src/shared/plan-node-types.ts` (run `npm run generate-code`).
- Settings `ScriptSettings { source?, timeoutMs? }` — `src/shared/node-settings.ts:46`.
- Processor `ScriptProcessor` — `src/backend/plan/nodes/graph/script-processor.ts`,
  registered in `NODE_PROCESSORS` (`plan-node-service.ts:55`).
- Edges: accepts `text` and `textArray` in, emits `text` out
  (`src/shared/node-edge-dictionary.ts`).

## Contract seen by a script author

Source runs as a **function body** — use `return` to produce output.

| Binding | Meaning |
|---|---|
| `inputs` | `{title, text}[]`, frozen, in edge order; `textArray` edges expand element-wise with `[n]` suffixed titles |
| `text` | shortcut for `inputs[0]?.text ?? ""` |
| `console.log/info/warn/error` | collected into `logs`, capped at 20 000 chars |

Return value coercion (`coerceOutput`): string as-is · number/boolean stringified ·
array joined with `\n` · object `JSON.stringify`'d · `undefined`/`null` → `""`.

On failure the node goes to `ERROR` **with the message as its content**. A silent
empty result would be indistinguishable from "the check found nothing", which is
the one thing a checker must never be ambiguous about.

## Isolation

`src/backend/script/run-script.ts` builds a `node:vm` context containing only the
bindings above. Absent: `require`, `process`, `fetch`, timers, `Buffer`, fs.
`codeGeneration: { strings: false, wasm: false }` blocks `eval` and `new Function`.
Synchronous execution is capped by `timeoutMs` (default 5 s).

**`node:vm` is isolation, not a hardened security boundary** — Node documents it as
such. It is proportionate for locally authored templates. Two known limits:

1. A `timeout` only interrupts *synchronous* code. There are no timers or I/O in
   the context, so a promise cannot do much, but it can escape the budget.
2. Prototype-level escapes from `vm` are a known class of attack. If templates ever
   become shareable between untrusted users, swap the engine for a WASM-isolated one
   (QuickJS) — only `run-script.ts` changes; the processor and node type do not.

## Why JS and not Python or Lua

- **Python**: the existing checkers in `write-enf-story/skills/.../scripts/*.py` are
  ~880 lines with zero non-stdlib imports, and roughly half of that is file walking
  that disappears here (inputs arrive over edges). Against that: an external
  interpreter means a per-user install, a per-platform path setting, and templates
  that break on someone else's machine.
- **Lua**: patterns are not regexes and are byte-oriented. For Cyrillic n-gram work
  that is disqualifying.
- **JS**: already bundled with Electron, sandboxable, and `\p{L}` with `/u` plus
  `Intl.Segmenter` handles Russian text as well as Python's `re`.

## Tests

`src/backend/script/run-script.test.ts` — 29 cases covering output coercion, input
exposure and freezing, Unicode property escapes on Cyrillic, absence of `require` /
`process` / `fetch` / timers / `Buffer`, blocked `eval` and `new Function`, no
declaration leakage between runs, timeout on an infinite loop, thrown and syntax
errors, and log capture including logs from a script that later throws.
