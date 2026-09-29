import type { RegenerateStatusEvent } from "@shared/RegenerateEvent"
import { act, render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

/** A for-each (#5) with a chapter node (#6) inside it. */
const definitions = [
  { id: 5, title: "Цикл по главам", type: "for-each", parent_id: null },
  { id: 6, title: "Текст главы", type: "text", parent_id: 5 },
]
let onStatus: (event: RegenerateStatusEvent) => void = () => {}

vi.mock("@/ipcClient", () => {
  // Each procedure answers by its path: `plan.nodes.findAll`, …
  const procedure = (path: string): Record<string, unknown> => ({
    useQuery: () => ({ data: path === "plan.nodes.findAll" ? definitions : undefined }),
    useSubscription: (_input: unknown, options: { onData: (event: RegenerateStatusEvent) => void }) => {
      if (path === "plan.nodes.aiGenerate.subscribeToStatusEvents") onStatus = options.onData
    },
  })
  const make = (path: string[]): unknown =>
    new Proxy(() => {}, {
      get: (_target, prop: string) => {
        const leaf = procedure(path.join("."))
        if (prop in leaf) return leaf[prop]
        return make([...path, prop])
      },
    })
  return { trpc: make([]) }
})

/** A run writing the chapter in these iterations of the loop. */
const writing = (...iterations: number[]): RegenerateStatusEvent => ({
  inProcess: true,
  stopping: false,
  running: iterations.map((i) => ({ node: { id: 6, title: "Текст главы", type: "text", path: `5:${i}` } })),
  generatedNew: 0,
  generatedSame: 0,
  generatedEmpty: 0,
  skipped: 0,
})

describe("the iteration on display, while a sequential loop runs", async () => {
  const { IterationSelectionProvider, useIterationSelection } = await import("../plan/iteration-selection")

  function Probe() {
    const { selected, running } = useIterationSelection()
    return (
      <span data-testid="probe">
        {selected(5, "")} of {running(5, "").join(",")}
      </span>
    )
  }

  it("follows the earliest of the iterations it writes side by side", async () => {
    const { getByTestId } = render(
      <IterationSelectionProvider>
        <Probe />
      </IterationSelectionProvider>,
    )

    await act(async () => onStatus(writing(2, 1, 3)))

    expect(getByTestId("probe").textContent).toBe("1 of 2,1,3")
  })
})
