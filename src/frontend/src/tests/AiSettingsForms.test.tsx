import { fireEvent, render, waitFor } from "@testing-library/react"
import { type AiEngineDefinition, BUILTIN_ENGINES } from "@shared/ai-engines"
import { describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "../ui-components/tooltip"

// The forms read engine config and fire mutations through tRPC; none of that
// matters here, so every path answers with an empty query or an idle mutation.
vi.mock("@/ipcClient", () => {
  const leaf: Record<string, unknown> = {
    useQuery: () => ({ data: {} }),
    useMutation: () => ({
      mutate: () => {},
      mutateAsync: async () => {},
      isPending: false,
      isError: false,
      isSuccess: false,
    }),
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

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
  Trans: ({ children }: { children: unknown }) => children,
}))

const GROK = BUILTIN_ENGINES.find((e) => e.id === "grok") as AiEngineDefinition
const NUMERIC_KEYS = GROK.aiSettingsFields.filter((f) => f.type === "integer" || f.type === "decimal").map((f) => f.key)

function input(container: HTMLElement, name: string): HTMLInputElement {
  const el = container.querySelector(`input[name="${name}"]`)
  if (!el) throw new Error(`no input named ${name}`)
  return el as HTMLInputElement
}

/** What would reach storage: settings go through JSON, which drops undefined. */
function stored<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

describe("per-node settings override — empty is not zero", async () => {
  const { AiGenerationSettingsForm } = await import("../ai/AiGenerationSettingsForm")

  function renderForm(value: Record<string, unknown>) {
    const onChange = vi.fn()
    const utils = render(
      <TooltipProvider>
        <AiGenerationSettingsForm
          aiEngineDef={GROK}
          defaultAiGenerationSettings={{}}
          value={value}
          onChange={onChange}
        />
      </TooltipProvider>,
    )
    const submit = () => fireEvent.submit(utils.container.querySelector("form") as HTMLFormElement)
    return { ...utils, onChange, submit }
  }

  const lastSaved = (onChange: ReturnType<typeof vi.fn>) =>
    stored(onChange.mock.calls[onChange.mock.calls.length - 1][0] as Record<string, unknown>)

  it("finds numeric fields to check", () => {
    expect(NUMERIC_KEYS.length).toBeGreaterThan(0)
  })

  it("does not save untouched numeric fields as 0", async () => {
    const { onChange, submit } = renderForm({ model: "m" })
    submit()
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const saved = lastSaved(onChange)
    for (const key of NUMERIC_KEYS) expect(saved, key).not.toHaveProperty(key)
  })

  it("saves a field the user emptied as absent, not 0", async () => {
    const { container, onChange, submit } = renderForm({ model: "m", temperature: 0.8, top_p: 0.9 })
    fireEvent.change(input(container, "temperature"), { target: { value: "" } })
    submit()
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const saved = lastSaved(onChange)
    expect(saved).not.toHaveProperty("temperature")
    expect(saved.top_p, "a field nobody touched keeps its value").toBe(0.9)
  })

  it("saves a typed 0 as 0", async () => {
    const { container, onChange, submit } = renderForm({ model: "m" })
    fireEvent.change(input(container, "temperature"), { target: { value: "0" } })
    submit()
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(lastSaved(onChange).temperature).toBe(0)
  })
})

describe("engine defaults editor — empty is not zero", async () => {
  // This is the editor the five real projects' zeros came from.
  const { default: AiEngineConfigEditor } = await import("../ai/AiEngineConfigEditor")

  function renderEditor(value: Record<string, unknown>) {
    const onChange = vi.fn()
    const utils = render(
      <TooltipProvider>
        <AiEngineConfigEditor active engine={GROK} value={value as never} onChange={onChange} />
      </TooltipProvider>,
    )
    return { ...utils, onChange }
  }

  it("saves an emptied default as absent, not 0", async () => {
    const { container, onChange } = renderEditor({
      api_key: "k",
      defaultAiGenerationSettings: { model: "m", temperature: 0.8 },
    })
    fireEvent.change(input(container, "defaultAiGenerationSettings.temperature"), { target: { value: "" } })
    // The editor saves on a 1-second debounce after any change.
    await waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 3000 })
    const saved = stored(onChange.mock.calls[onChange.mock.calls.length - 1][0] as Record<string, any>)
    expect(saved.defaultAiGenerationSettings).not.toHaveProperty("temperature")
    for (const key of NUMERIC_KEYS) {
      expect(saved.defaultAiGenerationSettings?.[key], `defaults.${key}`).not.toBe(0)
      expect(saved.summaryAiGenerationSettings?.[key], `summary.${key}`).not.toBe(0)
    }
  })

  it("saves a typed 0 default as 0", async () => {
    const { container, onChange } = renderEditor({ api_key: "k", defaultAiGenerationSettings: { model: "m" } })
    fireEvent.change(input(container, "defaultAiGenerationSettings.top_p"), { target: { value: "0" } })
    await waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 3000 })
    const saved = stored(onChange.mock.calls[onChange.mock.calls.length - 1][0] as Record<string, any>)
    expect(saved.defaultAiGenerationSettings.top_p).toBe(0)
  })
})
