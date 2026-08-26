import { describe, expect, it } from "vitest"
import { renderFormatTemplate } from "../../../ai/replaceTemplates.js"
import { buildFormatContext } from "./format-processor.js"

const input = (title: string, value: unknown, type: "text" | "textArray" = "text", position = 0) => ({
  edge: { type, position } as never,
  sourceNode: { title } as never,
  input: value,
})

describe("buildFormatContext", () => {
  it("keys a text input by its source node title", () => {
    expect(buildFormatContext([input("Draft", "hello")] as never)).toEqual({ Draft: "hello", projectName: "" })
  })

  it("keeps a textArray input as an array so each can iterate it", () => {
    const ctx = buildFormatContext([input("Chunks", ["a", "b"], "textArray")] as never)
    expect(ctx.Chunks).toEqual(["a", "b"])
  })

  it("survives a null input", () => {
    expect(buildFormatContext([input("Draft", null)] as never)).toEqual({ Draft: "", projectName: "" })
  })

  it("keeps Russian titles usable as bracket identifiers", () => {
    const ctx = buildFormatContext([input("Сборка драфта", "текст")] as never)
    expect(renderFormatTemplate("{{[Сборка драфта]}}", ctx)).toBe("текст")
  })
})

describe("renderFormatTemplate — escaping", () => {
  it("escapes by default, which is what an HTML template needs", () => {
    expect(renderFormatTemplate("{{x}}", { x: '<b>"&' })).toBe("&lt;b&gt;&quot;&amp;")
  })

  it("lets a template opt out with triple braces", () => {
    expect(renderFormatTemplate("{{{x}}}", { x: "<b>" })).toBe("<b>")
  })
})

describe("renderFormatTemplate — iteration", () => {
  it("iterates an array input with index", () => {
    const out = renderFormatTemplate("{{#each [Parts]}}<section id=ch{{@index}}>{{this}}</section>{{/each}}", {
      Parts: ["один", "два"],
    })
    expect(out).toBe("<section id=ch0>один</section><section id=ch1>два</section>")
  })

  it("escapes inside each", () => {
    expect(renderFormatTemplate("{{#each [P]}}{{this}}{{/each}}", { P: ["<i>"] })).toBe("&lt;i&gt;")
  })
})

describe("renderFormatTemplate — helpers", () => {
  it("counts words", () => {
    expect(renderFormatTemplate("{{words x}}", { x: " раз  два\nтри " })).toBe("3")
  })

  it("counts zero for a non-string", () => {
    expect(renderFormatTemplate("{{words x}}", { x: null })).toBe("0")
  })

  it("still has the arithmetic helpers", () => {
    expect(renderFormatTemplate("{{add 2 3}}", {})).toBe("5")
  })
})

describe("renderFormatTemplate — failures", () => {
  it("throws on an unknown variable instead of rendering a blank", () => {
    expect(() => renderFormatTemplate("{{missing}}", {})).toThrow(/render failed|not defined/i)
  })

  it("throws on a malformed template", () => {
    expect(() => renderFormatTemplate("{{#each}}", {})).toThrow(/render failed/i)
  })
})

describe("buildFormatContext — the project name", () => {
  it("exposes it as projectName, so a page can title itself", () => {
    const ctx = buildFormatContext([] as never, "Полотенце")
    expect(renderFormatTemplate("<h1>{{projectName}}</h1>", ctx)).toBe("<h1>Полотенце</h1>")
  })

  it("renders as empty rather than undefined when the project has no name", () => {
    expect(buildFormatContext([] as never, null).projectName).toBe("")
  })

  it("escapes it like any other value", () => {
    const ctx = buildFormatContext([] as never, "Bell & Co <b>")
    expect(renderFormatTemplate("{{projectName}}", ctx)).toBe("Bell &amp; Co &lt;b&gt;")
  })

  it("lets an explicit input of the same name win — the graph beats ambient data", () => {
    const ctx = buildFormatContext([input("projectName", "из графа")] as never, "из настроек")
    expect(ctx.projectName).toBe("из графа")
  })

  it("stays absent-safe when no name is passed at all", () => {
    expect(buildFormatContext([input("Draft", "x")] as never)).toEqual({ Draft: "x", projectName: "" })
  })
})
