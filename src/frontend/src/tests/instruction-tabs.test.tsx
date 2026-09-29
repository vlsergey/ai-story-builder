import type { PlanNodeRow } from "@shared/plan-graph"
import { TooltipProvider } from "@/ui-components/tooltip"
import { render } from "@testing-library/react"
import type { ReactElement } from "react"
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

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}))

vi.mock("@/lib/theme/theme-provider", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }))
vi.mock("@/i18n/locale", () => ({ useLocale: () => ({ locale: "en", t: (key: string) => key }) }))

// CodeMirror measures a layout jsdom does not have; a text area stands in for it.
vi.mock("@uiw/react-codemirror", () => ({
  default: () => <textarea />,
  EditorView: { lineWrapping: [] },
}))

/** As the app renders it: under the tooltip provider. */
const renderInApp = (ui: ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>)

/** Buttons inside buttons: invalid HTML, which React reports on every render. */
const nestedButtons = (container: HTMLElement) => container.querySelectorAll("button button").length

describe("the instruction tabs of the node editors", async () => {
  const { default: NodeEditor } = await import("../nodes/NodeEditor")
  const { default: FixProblemsNodeEditor } = await import("../plan/editors/FixProblemsNodeEditor")

  it("put no button inside another in the text node editor", () => {
    const { container } = renderInApp(
      <NodeEditor
        editorMode="generate"
        onEditorModeChange={() => {}}
        i18nPrefix="plan"
        onAcceptChanges={async () => {}}
        onChange={() => {}}
        onGenerate={() => {}}
        onImprove={() => {}}
        status="SAVED"
        value={{
          title: "Тема",
          content: "",
          ai_user_prompt: "",
          ai_system_prompt: "",
          ai_settings: null,
          review_base_content: null,
          ai_improve_instruction: null,
        }}
      />,
    )

    expect(container.querySelector('[role="tab"]'), "the tabs are there").not.toBeNull()
    expect(nestedButtons(container)).toBe(0)
  })

  it("put no button inside another in the fix-problems editor", () => {
    const row = { id: 3, title: "Ревью мира", type: "fix-problems", path: "", content: null } as unknown as PlanNodeRow
    const { container } = renderInApp(
      <FixProblemsNodeEditor
        dbValue={row}
        disabled={false}
        initialValue={row}
        value={row}
        nodeTypeSettings={{}}
        onChange={() => {}}
        onExternalUpdate={() => {}}
        onNodeTypeSettingsChange={() => {}}
        onRegenerate={() => {}}
        onSave={async () => {}}
        status="SAVED"
      />,
    )

    expect(container.querySelector('[role="tab"]'), "the tabs are there").not.toBeNull()
    expect(nestedButtons(container)).toBe(0)
  })
})
