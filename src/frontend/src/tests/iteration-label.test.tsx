import type { PlanNodeType } from "@shared/plan-node-types"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/ipcClient", () => {
  const leaf: Record<string, unknown> = {
    useQuery: () => ({ data: undefined }),
    useMutation: () => ({ mutate: () => {}, mutateAsync: async () => {}, isPending: false }),
    useSubscription: () => {},
    invalidate: () => {},
  }
  const make = (): unknown =>
    new Proxy(() => {}, {
      get: (_target, prop: string) => {
        if (prop in leaf) return leaf[prop]
        if (prop === "useUtils") return () => make()
        return make()
      },
    })
  return { trpc: make() }
})

describe("an iteration's label", async () => {
  const { iterationLabel } = await import("../plan/iteration-selection")
  const types = (id: number): PlanNodeType => (id === 27 ? "parallel" : "for-each")

  it("counts a sequential loop's iterations from one", () => {
    expect(iterationLabel("5:2", types)).toBe("#3")
  })

  it("names a parallel loop's iteration by its key, digits only or not", () => {
    expect(iterationLabel("27:a3f9c1", types)).toBe("#a3f9c1")
    expect(iterationLabel("27:042137", types)).toBe("#042137")
  })

  it("labels nested iterations outermost first", () => {
    expect(iterationLabel("5:0/27:042137", types)).toBe("#1/#042137")
  })

  it("tells a key from an index by its length when the loop's kind is not known", () => {
    expect(iterationLabel("27:042137")).toBe("#042137")
    expect(iterationLabel("5:2")).toBe("#3")
  })
})
