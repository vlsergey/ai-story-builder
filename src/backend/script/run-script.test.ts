import { describe, expect, it } from "vitest"
import { coerceOutput, runScript } from "./run-script.js"

const run = (source: string, inputs: { title: string; text: string }[] = [], timeoutMs?: number) =>
  runScript({ source, inputs, timeoutMs })

describe("runScript — output", () => {
  it("returns a string as-is", () => {
    const r = run(`return "hello"`)
    expect(r).toEqual({ ok: true, output: "hello", logs: [] })
  })

  it("joins an array with newlines", () => {
    const r = run(`return ["a", "b"]`)
    expect(r.ok && r.output).toBe("a\nb")
  })

  it("serialises an object as JSON", () => {
    const r = run(`return { n: 1 }`)
    expect(r.ok && JSON.parse(r.output)).toEqual({ n: 1 })
  })

  it("treats no return value as empty output", () => {
    const r = run(`const x = 1`)
    expect(r.ok && r.output).toBe("")
  })
})

describe("runScript — inputs", () => {
  const inputs = [
    { title: "Part 1", text: "первый" },
    { title: "Part 2", text: "второй" },
  ]

  it("exposes inputs with titles and text", () => {
    const r = run(`return inputs.map(i => i.title + "=" + i.text).join("|")`, inputs)
    expect(r.ok && r.output).toBe("Part 1=первый|Part 2=второй")
  })

  it("exposes the first input as `text`", () => {
    const r = run(`return text`, inputs)
    expect(r.ok && r.output).toBe("первый")
  })

  it("gives empty `text` when there are no inputs", () => {
    const r = run(`return text === "" ? "empty" : "no"`)
    expect(r.ok && r.output).toBe("empty")
  })

  it("does not let a script mutate its inputs", () => {
    const r = run(`try { inputs[0].text = "x" } catch (e) { return "frozen" } return inputs[0].text`, inputs)
    expect(r.ok && ["frozen", "первый"]).toContain(r.ok ? r.output : "")
  })
})

describe("runScript — Unicode text work", () => {
  it("handles Cyrillic with unicode property escapes", () => {
    const src = String.raw`return (text.match(/\p{L}+/gu) || []).length`
    const r = run(src, [{ title: "t", text: "Она вышла из душа" }])
    expect(r.ok && r.output).toBe("4")
  })

  it("counts repeated n-grams", () => {
    const source = String.raw`
      const words = text.toLowerCase().match(/\p{L}+/gu) || []
      const seen = new Map()
      for (let i = 0; i + 2 < words.length; i++) {
        const k = words.slice(i, i + 3).join(" ")
        seen.set(k, (seen.get(k) || 0) + 1)
      }
      return [...seen].filter(([, n]) => n > 1).map(([k, n]) => k + " ×" + n)
    `
    const r = run(source, [{ title: "t", text: "край ткани поехал и край ткани поехал снова" }])
    expect(r.ok && r.output).toContain("край ткани поехал ×2")
  })
})

describe("runScript — isolation", () => {
  it.each([
    ["require", `return typeof require`],
    ["process", `return typeof process`],
    ["fetch", `return typeof fetch`],
    ["setTimeout", `return typeof setTimeout`],
    ["Buffer", `return typeof Buffer`],
  ])("does not expose %s", (_name, source) => {
    const r = run(source)
    expect(r.ok && r.output).toBe("undefined")
  })

  it("blocks eval", () => {
    const r = run(`return eval("1+1")`)
    expect(r.ok).toBe(false)
  })

  it("blocks new Function", () => {
    const r = run(`return new Function("return 1")()`)
    expect(r.ok).toBe(false)
  })

  it("does not leak declarations between runs", () => {
    run(`var leaked = 42; return ""`)
    const r = run(`return typeof leaked`)
    expect(r.ok && r.output).toBe("undefined")
  })
})

describe("runScript — failure modes", () => {
  it("stops an infinite loop at the timeout", () => {
    const r = run(`while (true) {}`, [], 50)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/timed out|Script execution/i)
  })

  it("reports a thrown error instead of crashing", () => {
    const r = run(`throw new Error("boom")`)
    expect(r).toMatchObject({ ok: false, error: "Error: boom" })
  })

  it("reports a syntax error", () => {
    const r = run(`return (`)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/SyntaxError/)
  })
})

describe("runScript — console", () => {
  it("collects console.log into logs", () => {
    const r = run(`console.log("a", 1); return "done"`)
    expect(r.logs).toEqual(["a 1"])
    expect(r.ok && r.output).toBe("done")
  })

  it("keeps logs from a script that later throws", () => {
    const r = run(`console.log("before"); throw new Error("x")`)
    expect(r.logs).toEqual(["before"])
    expect(r.ok).toBe(false)
  })
})

describe("coerceOutput", () => {
  it.each([
    [undefined, ""],
    [null, ""],
    ["s", "s"],
    [3, "3"],
    [true, "true"],
    [["a", "b"], "a\nb"],
  ])("coerces %p", (input, expected) => {
    expect(coerceOutput(input)).toBe(expected)
  })
})
