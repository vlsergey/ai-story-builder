import { act, fireEvent, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/** A node whose generated text waits for review, as the server has it. */
const inReview = {
  id: 5,
  title: "Тема",
  type: "text",
  parent_id: null,
  path: "",
  node_type_settings: JSON.stringify({ userPrompt: "Тема" }),
  content: "Новая тема",
  summary: null,
  status: "GENERATED",
  in_review: 1,
  review_base_content: "Старая тема",
  ai_improve_instruction: null,
  rev: "r1",
  current: true,
  movedTo: null,
}
/** The same node once the server has accepted the review: a new revision. */
const accepted = { ...inReview, in_review: 0, review_base_content: null, rev: "r2" }

const patchCalls: unknown[] = []

vi.mock("@/ipcClient", () => {
  // Each procedure answers by its path: `plan.nodes.patch`, `plan.nodes.acceptReview`, …
  const procedure = (path: string): Record<string, unknown> => ({
    useQuery: () => ({ data: path === "plan.nodes.getById" ? inReview : undefined, isLoading: false }),
    useMutation: () => ({
      mutate: () => {},
      mutateAsync: async (input: unknown) => {
        if (path === "plan.nodes.patch") patchCalls.push(input)
        return path === "plan.nodes.acceptReview" ? accepted : undefined
      },
      isPending: false,
    }),
    useSubscription: () => {},
    invalidate: () => {},
    setData: () => {},
    fetch: async () => accepted,
  })
  const make = (path: string[]): unknown =>
    new Proxy(() => {}, {
      get: (_target, prop: string) => {
        const leaf = procedure(path.join("."))
        if (prop in leaf) return leaf[prop]
        if (prop === "useUtils") return () => make([])
        return make([...path, prop])
      },
    })
  return { trpc: make([]) }
})

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}))

// A stand-in for the editor's controls: the button that accepts what the model wrote.
vi.mock("@/nodes/NodeEditor", () => ({
  default: ({ onAcceptChanges }: { onAcceptChanges: () => Promise<void> }) => (
    <button type="button" onClick={() => onAcceptChanges()}>
      accept
    </button>
  ),
}))

describe("a text node whose generated text waits for review", async () => {
  const { default: PlanNodeEditor } = await import("../plan/editors/PlanNodeEditor")
  const { IterationSelectionProvider } = await import("../plan/iteration-selection")

  beforeEach(() => {
    patchCalls.length = 0
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("saves nothing more once the server has accepted the review", async () => {
    const { getByText } = render(
      <IterationSelectionProvider>
        <PlanNodeEditor nodeId={5} path="" panelApi={{ setTitle: () => {} }} />
      </IterationSelectionProvider>,
    )

    await act(async () => {
      fireEvent.click(getByText("accept"))
    })
    // Past the editor's autosave delay: a save now would carry the revision
    // from before the review was accepted, and fail as a conflict.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    expect(patchCalls).toEqual([])
  })
})
