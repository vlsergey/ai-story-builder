import { describe, expect, it } from "vitest"
import { formatFileName } from "./format-file.js"

const names = { projectFile: "Брат и сестра", projectName: "Без названия", title: "Вёрстка плана" }

describe("the file name of a saved page", () => {
  it("fills the mask from the project and the node", () => {
    expect(formatFileName("{{projectFile}} (план).html", names)).toBe("Брат и сестра (план).html")
    expect(formatFileName("{{projectName}} — {{title}}.html", names)).toBe("Без названия — Вёрстка плана.html")
  })

  it("keeps what HTML would escape", () => {
    expect(formatFileName("{{projectFile}}.html", { ...names, projectFile: "Tom & Jerry's" })).toBe(
      "Tom & Jerry's.html",
    )
  })

  it("puts _ for what a file name cannot hold", () => {
    expect(formatFileName("{{title}}.html", { ...names, title: 'a/b\\c:d*e?"f<g>h|i' })).toBe("a_b_c_d_e__f_g_h_i.html")
    expect(formatFileName("{{title}}. ", { ...names, title: "page" }), "Windows drops trailing dots and spaces").toBe(
      "page",
    )
  })

  it("names nothing when the mask gives nothing", () => {
    expect(formatFileName("  ", names)).toBe("")
    expect(formatFileName("{{unknown}}", names)).toBe("")
  })

  it("refuses a mask that does not parse", () => {
    expect(() => formatFileName("{{projectFile", names)).toThrow()
  })
})
