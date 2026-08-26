import { describe, expect, it } from "vitest"
import { buildChatRequest, describeContextWindowMismatch, takeLines } from "./ollama-client.js"

const base = {
  model: "qwen",
  systemPrompt: "sys",
  userPrompt: "usr",
  settings: {} as Record<string, unknown>,
}

describe("buildChatRequest — messages", () => {
  it("puts the system prompt first and the user prompt second", () => {
    const r = buildChatRequest(base as never)
    expect(r.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "usr" },
    ])
  })

  it("omits a blank system prompt rather than sending an empty message", () => {
    const r = buildChatRequest({ ...base, systemPrompt: "   " } as never)
    expect(r.messages).toEqual([{ role: "user", content: "usr" }])
  })

  it("sends an empty user message when there is no user prompt", () => {
    const r = buildChatRequest({ ...base, systemPrompt: null, userPrompt: null } as never)
    expect(r.messages).toEqual([{ role: "user", content: "" }])
  })

  it("always streams", () => {
    expect(buildChatRequest(base as never).stream).toBe(true)
  })
})

describe("buildChatRequest — options", () => {
  it("omits options entirely when nothing is set", () => {
    expect(buildChatRequest(base as never).options).toBeUndefined()
  })

  it("passes through positive numbers", () => {
    const r = buildChatRequest({
      ...base,
      settings: { temperature: 0.8, top_p: 0.9, num_ctx: 32768, max_output_tokens: 2000 },
    } as never)
    expect(r.options).toEqual({ temperature: 0.8, top_p: 0.9, num_ctx: 32768, num_predict: 2000 })
  })

  it.each([0, -1, Number.NaN, undefined, null, "8"])("drops non-positive or non-numeric %p", (v) => {
    const r = buildChatRequest({ ...base, settings: { temperature: v, num_ctx: v } } as never)
    expect(r.options).toBeUndefined()
  })

  it("maps max_output_tokens onto num_predict", () => {
    const r = buildChatRequest({ ...base, settings: { max_output_tokens: 512 } } as never)
    expect(r.options).toEqual({ num_predict: 512 })
  })
})

describe("buildChatRequest — structured output", () => {
  const schema = { name: "part", schema: { type: "object", properties: {} } }

  it("passes the JSON schema as format", () => {
    const r = buildChatRequest({ ...base, responseSchema: schema } as never)
    expect(r.format).toEqual(schema.schema)
  })

  it("skips format when schema enforcement is turned off", () => {
    const r = buildChatRequest({ ...base, responseSchema: schema, enforceSchema: false } as never)
    expect(r.format).toBeUndefined()
  })

  it("has no format when there is no schema", () => {
    expect(buildChatRequest(base as never).format).toBeUndefined()
  })
})

describe("buildChatRequest — thinking", () => {
  it("sends think:false explicitly when asked to skip reasoning", () => {
    expect(buildChatRequest({ ...base, settings: { think: false } } as never).think).toBe(false)
  })

  it("stays silent when thinking is not configured", () => {
    expect(buildChatRequest(base as never).think).toBeUndefined()
  })
})

describe("takeLines — NDJSON framing", () => {
  it("returns complete lines and keeps the partial tail", () => {
    expect(takeLines('{"a":1}\n{"b":2}\n{"c":')).toEqual({
      lines: ['{"a":1}', '{"b":2}'],
      rest: '{"c":',
    })
  })

  it("keeps everything as remainder when no newline arrived yet", () => {
    expect(takeLines('{"a"')).toEqual({ lines: [], rest: '{"a"' })
  })

  it("drops blank lines that the stream pads with", () => {
    expect(takeLines('{"a":1}\n\n\n{"b":2}\n')).toEqual({ lines: ['{"a":1}', '{"b":2}'], rest: "" })
  })

  it("survives an empty buffer", () => {
    expect(takeLines("")).toEqual({ lines: [], rest: "" })
  })
})

describe("describeContextWindowMismatch — the num_ctx trap", () => {
  const loaded = (model: string, context_length?: number) => [{ model, context_length }]

  it("says nothing when no window was requested", () => {
    expect(describeContextWindowMismatch(loaded("qwen", 8192), "qwen", undefined)).toBeNull()
  })

  it("says nothing when the model is not resident — it will load with our window", () => {
    expect(describeContextWindowMismatch([], "qwen", 65536)).toBeNull()
  })

  it("says nothing when another model is resident", () => {
    expect(describeContextWindowMismatch(loaded("llama", 8192), "qwen", 65536)).toBeNull()
  })

  it("says nothing when the resident window matches", () => {
    expect(describeContextWindowMismatch(loaded("qwen", 65536), "qwen", 65536)).toBeNull()
  })

  it("says nothing when the resident window is larger than asked", () => {
    expect(describeContextWindowMismatch(loaded("qwen", 131072), "qwen", 65536)).toBeNull()
  })

  it("says nothing when the daemon does not report a window", () => {
    expect(describeContextWindowMismatch(loaded("qwen"), "qwen", 65536)).toBeNull()
  })

  it("complains when the resident window is smaller than asked", () => {
    const msg = describeContextWindowMismatch(loaded("qwen", 8192), "qwen", 65536)
    expect(msg).toContain("8192")
    expect(msg).toContain("65536")
    expect(msg).toContain("qwen")
  })

  it("finds the model among several resident ones", () => {
    const models = [
      { model: "llama", context_length: 131072 },
      { model: "qwen", context_length: 4096 },
    ]
    expect(describeContextWindowMismatch(models, "qwen", 32768)).toContain("4096")
  })
})
