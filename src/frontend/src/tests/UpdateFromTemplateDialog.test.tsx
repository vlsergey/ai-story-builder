import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/** What the dialog asked the analysis for, and what it applied. */
const analyzed: unknown[] = []
const applied: unknown[] = []
let menuAction: (action: string) => void = () => {}

/** The wizard pages of the template, by field. */
const pageOf: Record<string, { id: string; title: string }> = {
  minCharacterAge: { id: "rating-and-synopsis", title: "Рейтинг и синопсис" },
  chunksCount: { id: "chunks-count", title: "Объём прозы" },
}

/** The fields the template lets an update change. */
const fields = [
  {
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
  {
    name: "chunksCount",
    type: "integer",
    label: "Число чанков прозы",
    min: 2,
    max: 30,
    defaultValue: 20,
    editableOnUpdate: true,
  },
]

/** The values the project holds, as the backend has them now. */
let held: Record<string, string> = {}
/** What react-query still keeps from an earlier analysis, by input: it answers with it first. */
const cached = new Map<string, unknown>()

function analysis(parameters: Record<string, string | number> = {}) {
  const values: Record<string, string> = { ...held }
  for (const [name, value] of Object.entries(parameters)) values[name] = String(value)
  // The template itself has not changed: only a parameter rewrites prompts.
  const rewritten = Object.keys(parameters).length > 0
  return {
    templateFile: "fiction-arc.ru.json",
    unchangedCount: 40,
    updatedNodes: rewritten ? [{ title: "План чанка", type: "text" }] : [],
    newNodes: [],
    newEdges: [],
    removedEdges: [],
    retypedNodes: [],
    retypeBlocked: [],
    parameters: fields.map((field) => ({
      page: pageOf[field.name],
      field,
      value: values[field.name] ?? String(field.defaultValue),
    })),
  }
}

vi.mock("@/ipcClient", () => {
  // Each procedure answers by its path: `project.analyzeTemplateUpdate`, …
  const procedure = (path: string): Record<string, unknown> => ({
    useQuery: (
      input: { parameters?: Record<string, string | number> } | undefined,
      options?: { cacheTime?: number },
    ) => {
      if (path !== "project.analyzeTemplateUpdate") return { data: undefined }
      analyzed.push(input?.parameters)
      // What was cached answers first — unless the query keeps nothing once
      // its dialog closes: then an opening sees the project as it is now.
      const key = JSON.stringify(input) + (options?.cacheTime === 0 ? JSON.stringify(held) : "")
      if (!cached.has(key)) cached.set(key, analysis(input?.parameters))
      return { data: cached.get(key), isLoading: false, isPreviousData: false, error: null }
    },
    useMutation: () => ({
      mutateAsync: async (input: { parameters?: Record<string, string | number> }) => {
        if (path !== "project.applyTemplateUpdate") return
        applied.push(input)
        for (const [name, value] of Object.entries(input.parameters ?? {})) held[name] = String(value)
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
    held = {}
    cached.clear()
  })

  async function open() {
    await act(async () => menuAction("update-from-template"))
  }
  async function unfold(pageTitle: string) {
    await act(async () => {
      fireEvent.click(screen.getByText(pageTitle))
    })
  }
  const chunks = () => screen.getByLabelText("Число чанков прозы") as HTMLInputElement
  const apply = () => screen.getByText("UpdateFromTemplateDialog.apply").closest("button") as HTMLButtonElement
  async function setChunks(value: string) {
    await act(async () => {
      fireEvent.change(chunks(), { target: { value } })
    })
  }

  it("folds the template's parameters by wizard page", async () => {
    render(<UpdateFromTemplateDialog />)
    await open()

    expect(screen.getByText("Рейтинг и синопсис")).toBeTruthy()
    expect(screen.getByText("Объём прозы")).toBeTruthy()
    expect(screen.queryByLabelText("Число чанков прозы"), "folded until opened").toBeNull()

    await unfold("Объём прозы")

    expect(chunks().value, "the value the project holds").toBe("20")
    expect(screen.queryByText("Минимальный возраст персонажей"), "another page stays folded").toBeNull()
    expect(apply().disabled, "nothing to apply yet").toBe(true)
  })

  it("analyses and applies with the parameter the user changed", async () => {
    render(<UpdateFromTemplateDialog />)
    await open()
    await unfold("Объём прозы")

    await setChunks("10")

    expect(analyzed.at(-1)).toEqual({ chunksCount: 10 })
    expect(screen.getByText("UpdateFromTemplateDialog.updatedNodesHeader"), "the prompts it rewrites").toBeTruthy()
    await act(async () => {
      fireEvent.click(apply())
    })
    expect(applied).toEqual([{ removeMissingEdges: false, parameters: { chunksCount: 10 } }])
  })

  it("does not apply a value the field does not allow", async () => {
    render(<UpdateFromTemplateDialog />)
    await open()
    await unfold("Объём прозы")

    await setChunks("10")
    await setChunks("99")

    expect(apply().disabled, "the last valid value is not what the dialog shows").toBe(true)
  })

  it("opens again on what the project holds after an update, not on an earlier analysis", async () => {
    render(<UpdateFromTemplateDialog />)
    await open()
    await unfold("Объём прозы")
    await setChunks("10")
    await act(async () => {
      fireEvent.click(apply())
    })

    await open()
    await unfold("Объём прозы")

    expect(chunks().value).toBe("10")
  })
})
