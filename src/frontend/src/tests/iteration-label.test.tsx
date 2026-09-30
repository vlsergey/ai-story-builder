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

  it("counts a loop's iterations from one", () => {
    expect(iterationLabel("5:2")).toBe("#3")
  })

  it("labels nested iterations outermost first", () => {
    expect(iterationLabel("5:0/27:11")).toBe("#1/#12")
  })

  it("keeps a key that is not an index as it is", () => {
    expect(iterationLabel("27:a3f9c1")).toBe("#a3f9c1")
  })
})
