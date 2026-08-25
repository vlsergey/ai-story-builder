import vm from "node:vm"

/** One input edge, already materialised to text. */
export interface ScriptInput {
  title: string
  text: string
}

export interface RunScriptOptions {
  /** JS source. Runs as a function body; use `return` to produce the output. */
  source: string
  inputs: ScriptInput[]
  /** Wall-clock budget for synchronous execution. */
  timeoutMs?: number
}

export type RunScriptResult =
  | { ok: true; output: string; logs: string[] }
  | { ok: false; error: string; logs: string[] }

export const DEFAULT_SCRIPT_TIMEOUT_MS = 5_000

/** Max characters kept from console.log calls, to keep a runaway loop from eating memory. */
const MAX_LOG_CHARS = 20_000

/**
 * Coerce whatever the script returned into the text a `text` edge carries.
 * Arrays join with newlines (the common "list of findings" shape); plain
 * objects go through JSON so a script can return structured data without
 * inventing its own formatting.
 */
export function coerceOutput(value: unknown): string {
  if (value === undefined || value === null) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return value.map((v) => coerceOutput(v)).join("\n")
  try {
    return JSON.stringify(value, null, 2) ?? ""
  } catch {
    return String(value)
  }
}

/**
 * Run a template-authored script in an isolated context.
 *
 * The context deliberately has no `require`, `process`, `fetch`, timers or
 * file system: a script is a pure text→text function over its inputs. Code
 * generation (`eval`, `new Function`) is disabled, and synchronous execution
 * is capped by `timeoutMs`.
 *
 * NOTE: `node:vm` is isolation, not a hardened security boundary — see
 * `.claude/research/script-node.md`. It is proportionate for locally authored
 * templates; swapping in a WASM engine later only changes this file.
 */
export function runScript(options: RunScriptOptions): RunScriptResult {
  const { source, inputs, timeoutMs = DEFAULT_SCRIPT_TIMEOUT_MS } = options
  const logs: string[] = []
  let logChars = 0

  const pushLog = (...args: unknown[]) => {
    if (logChars >= MAX_LOG_CHARS) return
    const line = args.map((a) => (typeof a === "string" ? a : coerceOutput(a))).join(" ")
    logChars += line.length
    logs.push(line.slice(0, Math.max(0, MAX_LOG_CHARS - (logChars - line.length))))
  }

  const frozenInputs = Object.freeze(
    inputs.map((i) => Object.freeze({ title: i.title, text: i.text })),
  ) as readonly ScriptInput[]

  const sandbox: Record<string, unknown> = {
    inputs: frozenInputs,
    /** Convenience: the first input's text, which is what most checkers want. */
    text: frozenInputs[0]?.text ?? "",
    console: Object.freeze({ log: pushLog, info: pushLog, warn: pushLog, error: pushLog }),
  }

  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  })

  try {
    // Wrapped in an IIFE so the source can `return`, and so `let`/`const`
    // declarations don't leak into the shared context between runs.
    const wrapped = `(function () {\n"use strict";\n${source}\n})()`
    const value = vm.runInContext(wrapped, context, {
      timeout: timeoutMs,
      displayErrors: true,
      filename: "script-node.js",
    })
    return { ok: true, output: coerceOutput(value), logs }
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    return { ok: false, error: message, logs }
  }
}
