import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  expandParallel,
  MIN_KEY_LENGTH,
  type ParallelNodeContent,
  parallelIterationKeys,
  parseParallelContent,
} from "../../../../shared/parallel-plan-node.js"

const sha256 = (element: string) => createHash("sha256").update(element, "utf8").digest("hex")
const EMPTY: ParallelNodeContent = { keyLength: MIN_KEY_LENGTH, hashes: {}, order: [] }

/** Two different elements whose hashes share their first `length` hex characters. */
function collidingPair(length: number): [string, string] {
  const seen = new Map<string, string>()
  for (let i = 0; ; i++) {
    const element = `element ${i}`
    const prefix = sha256(element).slice(0, length)
    const other = seen.get(prefix)
    if (other !== undefined) return [other, element]
    seen.set(prefix, element)
  }
}

describe("parallel loop keys", () => {
  it("keys each element by the shortest prefix of its hash, six characters at least", () => {
    const { content } = expandParallel(EMPTY, ["Аня", "Боря"], sha256)

    expect(content.keyLength).toBe(MIN_KEY_LENGTH)
    expect(content.order).toEqual([sha256("Аня").slice(0, 6), sha256("Боря").slice(0, 6)])
  })

  it("makes identical elements one iteration, listed at every position they take", () => {
    const { content, elements } = expandParallel(EMPTY, ["Аня", "Боря", "Аня"], sha256)

    expect(content.order[0]).toBe(content.order[2])
    expect([...elements.values()]).toEqual(["Аня", "Боря"])
    expect(parallelIterationKeys(JSON.stringify(content))).toEqual([content.order[0], content.order[1]])
  })

  it("grows the key when two elements share a prefix, and renames the iterations that stay", () => {
    const [first, second] = collidingPair(MIN_KEY_LENGTH)
    const before = expandParallel(EMPTY, [first, "Боря"], sha256).content

    const after = expandParallel(before, [first, second], sha256)

    expect(after.content.keyLength).toBeGreaterThan(MIN_KEY_LENGTH)
    expect(new Set(after.content.order).size).toBe(2)
    expect(after.renamed).toEqual([{ from: sha256(first).slice(0, 6), to: after.content.order[0] }])
  })

  it("never shrinks a key once grown", () => {
    const [first, second] = collidingPair(MIN_KEY_LENGTH)
    const grown = expandParallel(EMPTY, [first, second], sha256).content

    const after = expandParallel(grown, [first], sha256)

    expect(after.content.keyLength).toBe(grown.keyLength)
    expect(after.renamed).toEqual([])
  })

  it("reads unreadable content as a loop that never ran", () => {
    expect(parseParallelContent("{not json")).toEqual(EMPTY)
    expect(parallelIterationKeys(null)).toEqual([])
  })
})
