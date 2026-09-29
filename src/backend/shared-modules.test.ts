import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

// The backend runs the shared modules under Node's ESM loader, which does not
// guess a file's extension: `from "./ai-engines"` stops the app at startup,
// though vitest and vite both resolve it. A type-only import is erased and
// never reaches the loader.
const SHARED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../shared")
// One import or re-export statement, up to its `from`: it may span lines,
// but not run into the next statement, since the code has no semicolons.
const STATEMENT = /^(import|export)(\s+type\b)?(?:(?!^(?:import|export)\b)[\s\S])*?\bfrom\s+"([^"]+)"/gm

describe("the shared modules, as the backend loads them", () => {
  it("import one another by file name, extension included", () => {
    const bare: string[] = []
    for (const file of readdirSync(SHARED).filter((name) => name.endsWith(".ts"))) {
      const source = readFileSync(path.join(SHARED, file), "utf8")
      for (const [, , typeOnly, specifier] of source.matchAll(STATEMENT)) {
        if (typeOnly || !specifier.startsWith(".")) continue
        if (!/\.(?:js|json)$/.test(specifier)) bare.push(`${file}: ${specifier}`)
      }
    }
    expect(bare).toEqual([])
  })

  it("tells a value import from a type-only one", () => {
    const found = [
      ...'import z from "zod"\nimport type { A } from "./a"\nimport { b } from "./b"\n'.matchAll(STATEMENT),
    ].map(([, , typeOnly, specifier]) => `${typeOnly ? "type " : ""}${specifier}`)
    expect(found).toEqual(["zod", "type ./a", "./b"])
  })
})
