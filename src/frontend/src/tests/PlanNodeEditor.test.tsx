import { act, fireEvent, render } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/** The row the editor opens: a loop child in an iteration the loop does not have. */
const rows: Record<string, ReturnType<typeof rowAt>> = {}
const patchCalls: { data: Record<string, unknown> }[] = []

function rowAt(path: string, current: boolean) {
  return {
    id: 12,
    title: "Профиль",
    type: "text",
    parent_id: 10,
    path,
    node_type_settings: JSON.stringify({ userPrompt: "" }),
    content: null,
    summary: null,
    status: "OUTDATED",
    rev: "",
    current,
  }
}

vi.mock("@/ipcClient", () => {
  const leaf: Record<string, unknown> = {
    useQuery: (input: { path?: string } | undefined) => ({
      data: input === undefined ? [] : rows[input.path ?? ""],
      isLoading: false,
    }),
    useMutation: () => ({
      mutate: () => {},
      mutateAsync: async (input: { data: Record<string, unknown> }) => {
        patchCalls.push(input)
        return { ...rows["10:0"], ...input.data }
      },
      isPending: false,
    }),
    useSubscription: () => {},
    invalidate: () => {},
    setData: () => {},
    fetch: async () => rows["10:0"],
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

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}))

// A stand-in editor: a button that saves a new prompt with a text, as typing both does.
vi.mock("../plan/editors/NodeTypeEditors", () => ({
  NodeTypeEditors: {
    text: ({ value, onSave, iterationMissing }: any) => (
      <button
        type="button"
        data-missing={String(iterationMissing)}
        onClick={() =>
          onSave({
            ...value,
            content: "text",
            node_type_settings: JSON.stringify({ userPrompt: "Профиль {{[Персонаж]}}" }),
          })
        }
      >
        save
      </button>
    ),
  },
}))

describe("the editor of a loop child", async () => {
  const { default: PlanNodeEditor } = await import("../plan/editors/PlanNodeEditor")
  const { IterationSelectionProvider } = await import("../plan/iteration-selection")

  beforeEach(() => {
    patchCalls.length = 0
  })

  it("saves the prompt, but not a text, in an iteration the loop does not have yet", async () => {
    rows["10:0"] = rowAt("10:0", false)
    const { getByText } = render(
      <IterationSelectionProvider>
        <PlanNodeEditor nodeId={12} path="10:0" panelApi={{ setTitle: () => {} }} />
      </IterationSelectionProvider>,
    )

    await act(async () => {
      fireEvent.click(getByText("save"))
    })

    expect(getByText("save").getAttribute("data-missing")).toBe("true")
    expect(patchCalls.map((call) => Object.keys(call.data))).toEqual([["node_type_settings"]])
  })
})
