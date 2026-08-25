import { describe, expect, it } from "vitest"
import { buildChatRequest, takeLines } from "./ollama-client.js"

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
