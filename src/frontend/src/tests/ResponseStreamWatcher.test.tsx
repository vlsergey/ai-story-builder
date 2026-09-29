import { act, render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

const handlers: ((data: unknown) => void)[] = []

vi.mock("@/ipcClient", () => {
  const leaf: Record<string, unknown> = {
    useQuery: () => ({ data: undefined }),
    useMutation: () => ({ mutate: () => {}, mutateAsync: async () => {}, isPending: false }),
    useSubscription: (_input: unknown, options: { onData: (data: unknown) => void }) => {
      handlers.push((data) => options.onData(data))
    },
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
;(HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {}

describe("the stream watcher, with two iterations writing at once", async () => {
  const { default: ResponseStreamWatcher } = await import("../plan/ResponseStreamWatcher")

  const send = (path: string, event: Record<string, unknown>) =>
    act(() => {
      handlers.at(-1)?.({ nodeId: 7, path, contentPath: [], event })
    })
  const delta = (path: string, text: string) => send(path, { type: "response.output_text.delta", delta: text })

  it("keeps each stream whole, following the one that started first", () => {
    const { container } = render(<ResponseStreamWatcher />)
    const shown = () => (container.querySelector("textarea") as HTMLTextAreaElement).value

    delta("3:aaaaaa", "Аня идёт ")
    delta("3:bbbbbb", "Боря спит ")
    delta("3:aaaaaa", "домой.")
    delta("3:bbbbbb", "долго.")
    expect(shown()).toBe("Аня идёт домой.")

    send("3:aaaaaa", { type: "response.completed" })
    expect(shown(), "then the next one still writing").toBe("Боря спит долго.")
  })
})
