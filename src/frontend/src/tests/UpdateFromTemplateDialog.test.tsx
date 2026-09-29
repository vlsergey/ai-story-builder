import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/** What the dialog asked the analysis for, and what it applied. */
const analyzed: unknown[] = []
const applied: unknown[] = []
let menuAction: (action: string) => void = () => {}

/** The parameters the template lets an update change, as the project holds them. */
const parameters = [
  {
    field: {
      name: "minCharacterAge",
      type: "select",
      label: "Минимальный возраст персонажей",
      editableOnUpdate: true,
      defaultValue: "none",
      options: [
        { value: "none", label: "Не указано", text: "" },
        { value: "21", label: "21+", text: "Всем героям не менее 21 года." },
      ],
    },
    value: "none",
  },
  {
    field: {
      name: "chunksCount",
      type: "integer",
      label: "Число чанков прозы",
      min: 2,
      max: 30,
      defaultValue: 20,
      editableOnUpdate: true,
    },
    value: "20",
  },
]

vi.mock("@/ipcClient", () => {
  // Each procedure answers by its path: `project.analyzeTemplateUpdate`, …
  const procedure = (path: string): Record<string, unknown> => ({
    useQuery: (input: { parameters?: Record<string, unknown> } | undefined) => {
      if (path !== "project.analyzeTemplateUpdate") return { data: undefined }
      analyzed.push(input?.parameters)
      // The template itself has not changed: only a parameter rewrites prompts.
      const rewritten = Object.keys(input?.parameters ?? {}).length > 0
      return {
        data: {
          templateFile: "fiction-arc.ru.json",
          unchangedCount: 40,
          updatedNodes: rewritten ? [{ title: "План чанка", type: "text" }] : [],
          newNodes: [],
          newEdges: [],
          removedEdges: [],
          retypedNodes: [],
          retypeBlocked: [],
          parameters,
        },
        isLoading: false,
        isPreviousData: false,
        error: null,
      }
    },
    useMutation: () => ({
      mutateAsync: async (input: unknown) => {
        if (path === "project.applyTemplateUpdate") applied.push(input)
      },
    }),
    useSubscription: (_input: unknown, options: { onData: (action: string) => void }) => {
      if (path === "native.menuState.backToFrontMenuActions.subscribe") menuAction = options.onData
    },
    invalidate: async () => {},
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

describe("the update-from-template dialog", async () => {
  const { default: UpdateFromTemplateDialog } = await import("../projects/UpdateFromTemplateDialog")

  beforeEach(() => {
    analyzed.length = 0
    applied.length = 0
  })

  async function open() {
    render(<UpdateFromTemplateDialog />)
    await act(async () => menuAction("update-from-template"))
  }
  const apply = () => screen.getByText("UpdateFromTemplateDialog.apply").closest("button") as HTMLButtonElement

  it("offers the template's parameters, starting from the project's values", async () => {
    await open()

    expect((screen.getByLabelText("Число чанков прозы") as HTMLInputElement).value).toBe("20")
    expect(screen.getByText("Минимальный возраст персонажей")).toBeTruthy()
    expect(apply().disabled, "nothing to apply yet").toBe(true)
  })

  it("analyses and applies with the parameter the user changed", async () => {
    await open()

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Число чанков прозы"), { target: { value: "10" } })
    })

    expect(analyzed.at(-1)).toEqual({ chunksCount: 10 })
    expect(screen.getByText("UpdateFromTemplateDialog.updatedNodesHeader"), "the prompts it rewrites").toBeTruthy()
    await act(async () => {
      fireEvent.click(apply())
    })
    expect(applied).toEqual([{ removeMissingEdges: false, parameters: { chunksCount: 10 } }])
  })

  it("does not apply a value the field does not allow", async () => {
    await open()

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Число чанков прозы"), { target: { value: "10" } })
    })
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Число чанков прозы"), { target: { value: "99" } })
    })

    expect(apply().disabled, "the last valid value is not what the dialog shows").toBe(true)
  })
})
