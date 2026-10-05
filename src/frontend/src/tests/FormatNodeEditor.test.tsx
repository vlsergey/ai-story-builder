import type { FormatSettings } from "@shared/node-settings"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/** What the backend answers for the file a mask names, and the masks it was asked about. */
let target: { folder: string | null; name: string; error: string | null } = {
  folder: "C:\\Projects",
  name: "Брат и сестра (план).html",
  error: null,
}
const asked: unknown[] = []

vi.mock("@/ipcClient", () => {
  const procedure = (path: string): Record<string, unknown> => ({
    useQuery: (input: unknown) => {
      if (path === "plan.nodes.savedPageTarget") asked.push(input)
      return { data: path === "plan.nodes.savedPageTarget" ? target : undefined }
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

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key),
    i18n: { language: "en" },
  }),
}))

describe("the editor of a page", async () => {
  const { default: FormatNodeEditor } = await import("../plan/editors/FormatNodeEditor")

  const open = (settings: FormatSettings, path = "") => {
    const changes: FormatSettings[] = []
    const row = { id: 41, title: "Вёрстка плана", type: "format", path } as never
    render(
      <FormatNodeEditor
        dbValue={row}
        value={row}
        initialValue={row}
        disabled={false}
        nodeTypeSettings={settings}
        onChange={() => {}}
        onExternalUpdate={() => {}}
        onNodeTypeSettingsChange={(next) => changes.push(next)}
        onRegenerate={() => {}}
        onSave={async () => {}}
        status="SAVED"
      />,
    )
    return changes
  }

  beforeEach(() => {
    asked.length = 0
    target = { folder: "C:\\Projects", name: "Брат и сестра (план).html", error: null }
  })

  it("shows the file the mask names, and the folder it goes to", () => {
    open({ template: "<p></p>", saveNextToProject: true, fileName: "{{projectFile}} (план).html" })

    expect(asked).toContainEqual({ id: 41, fileName: "{{projectFile}} (план).html" })
    const preview = screen.getByTestId("saved-page-preview").textContent
    expect(preview).toContain("Брат и сестра (план).html")
    expect(preview).toContain("C:\\\\Projects")
  })

  it("keeps the choice to save the page next to the project", () => {
    const changes = open({ template: "<p></p>" })

    fireEvent.click(screen.getByRole("switch"))

    expect(changes.at(-1)).toMatchObject({ template: "<p></p>", saveNextToProject: true })
  })

  it("keeps the mask as it is typed, starting from the default one", () => {
    const changes = open({ template: "<p></p>" })
    const mask = screen.getByLabelText("formatNode.fileName") as HTMLInputElement
    expect(mask.value).toBe("{{projectFile}}.html")

    fireEvent.change(mask, { target: { value: "{{title}}.html" } })

    expect(changes.at(-1)).toMatchObject({ fileName: "{{title}}.html" })
  })

  it("says why a mask names no file", () => {
    target = { folder: "C:\\Projects", name: "", error: null }
    open({ template: "<p></p>", fileName: "{{nothing}}" })

    expect(screen.getByTestId("saved-page-preview").textContent).toBe("formatNode.fileNameEmpty")
  })

  it("offers no saving from inside a loop", () => {
    open({ template: "<p></p>" }, "5:0")

    expect(screen.getByRole("switch")).toBeDisabled()
    expect(screen.getByText("formatNode.insideLoop")).toBeInTheDocument()
  })
})
