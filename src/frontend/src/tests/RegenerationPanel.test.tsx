import type { RegenerateStatusEvent, RunningNode } from "@shared/RegenerateEvent"
import { act, fireEvent, render, screen } from "@testing-library/react"
import type { DockviewPanelApi } from "dockview"
import { beforeEach, describe, expect, it, vi } from "vitest"

/** A for-each (#5) with a chapter node (#6) inside it. */
const definitions = [
  { id: 5, title: "Цикл по главам", type: "for-each", parent_id: null },
  { id: 6, title: "Текст главы", type: "text", parent_id: 5 },
]
const STATUS = "plan.nodes.aiGenerate.subscribeToStatusEvents"
const STREAM = "plan.nodes.aiGenerate.subscribeToResponseStreamEvents"

const subscribers = new Map<string, Set<(data: unknown) => void>>()
/** How starting a run ends. */
let startRun: () => Promise<unknown> = async () => undefined

vi.mock("@/ipcClient", async () => {
  const { useEffect, useRef } = await import("react")
  // Each procedure answers by its path: `plan.nodes.findAll`, …
  const procedure = (path: string): Record<string, unknown> => ({
    useQuery: () => ({ data: path === "plan.nodes.findAll" ? definitions : undefined }),
    useMutation: () => {
      const run = async () => (path === "plan.nodes.aiGenerate.startForAll" ? startRun() : undefined)
      // As react-query has it: `mutate` keeps a failure to the mutation's state, `mutateAsync` hands it over.
      return { mutate: () => void run().catch(() => {}), mutateAsync: run, isPending: false }
    },
    useSubscription: (_input: unknown, options: { onData: (data: unknown) => void }) => {
      const latest = useRef(options)
      latest.current = options
      useEffect(() => {
        const handler = (data: unknown) => latest.current.onData(data)
        const handlers = subscribers.get(path) ?? new Set()
        subscribers.set(path, handlers.add(handler))
        return () => void handlers.delete(handler)
      }, [])
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
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}))
vi.mock("@/i18n/locale", () => ({ useLocale: () => ({ locale: "en", exists: () => true }) }))
vi.mock("../plan/RegenerateOptionsForm", () => ({ default: () => null }))

const send = (path: string, data: unknown) =>
  act(() => {
    for (const handler of [...(subscribers.get(path) ?? [])]) handler(data)
  })

/** The chapter node in its iteration, counted from one as its label counts it. */
const chapter = (iteration: number): RunningNode => ({
  node: { id: 6, title: "Текст главы", type: "text", path: `5:${iteration - 1}` },
})
/** The run writes the chapter in the given iterations, in the order they started. */
const writing = (...iterations: number[]) =>
  send(STATUS, {
    inProcess: iterations.length > 0,
    stopping: false,
    running: iterations.map(chapter),
    loops: [],
    generatedNew: 0,
    generatedSame: 0,
    generatedEmpty: 0,
    skipped: 0,
  } satisfies RegenerateStatusEvent)

/** An event of the model response the chapter's call streams in the iteration. */
const streams = (iteration: number, event: Record<string, unknown>, contentPath: (string | number)[] = ["content"]) =>
  send(STREAM, { nodeId: 6, path: `5:${iteration - 1}`, contentPath, event })
const writes = (iteration: number, text: string, contentPath?: (string | number)[]) =>
  streams(iteration, { type: "response.output_text.delta", delta: text }, contentPath)

/** The line of the chapter in the iteration: the head of its accordion item. */
const line = (iteration: number) => screen.getByRole("button", { name: new RegExp(`Текст главы.*#${iteration}\\)`) })
const unfolded = (iteration: number) => line(iteration).getAttribute("aria-expanded") === "true"
/** What the item of the chapter in the iteration shows; null while it is folded. */
const shown = (iteration: number) =>
  screen.queryByRole("region", { name: new RegExp(`#${iteration}\\)`) })?.textContent ?? null

describe("the regeneration panel", async () => {
  const { default: RegenerationPanel } = await import("../plan/RegenerationPanel")
  const { IterationSelectionProvider } = await import("../plan/iteration-selection")

  const open = () =>
    render(
      <IterationSelectionProvider>
        <RegenerationPanel panelApi={{ setTitle: () => {} } as unknown as DockviewPanelApi} />
      </IterationSelectionProvider>,
    )

  beforeEach(() => {
    startRun = async () => undefined
  })

  describe("while a run writes", () => {
    it("lists each node being written, the one that started first unfolded", () => {
      const { container } = open()
      writing(1, 2)

      expect(unfolded(1)).toBe(true)
      expect(unfolded(2)).toBe(false)
      expect(shown(1), "nothing has come from the model yet").toBe("regeneration.dispatched")
      expect(container.querySelector("textarea"), "no stream of the panel's own below the list").toBeNull()
    })

    it("keeps what two iterations write at once apart, each under its own node", () => {
      open()
      writing(1, 2)

      writes(1, "Аня идёт ")
      writes(2, "Боря спит ")
      writes(1, "домой.")
      writes(2, "долго.")
      expect(shown(1)).toBe("Аня идёт домой.")

      fireEvent.click(line(2))
      expect(shown(2)).toBe("Боря спит долго.")
      expect(shown(1), "the first stays unfolded beside it").toBe("Аня идёт домой.")
    })

    it("shows what the model thinks until it writes", () => {
      open()
      writing(1)

      streams(1, { type: "response.created" })
      streams(1, {
        type: "response.output_item.added",
        output_index: 0,
        item: { type: "reasoning", id: "rs_1", summary: [] },
      })
      streams(1, {
        type: "response.reasoning_summary_text.delta",
        output_index: 0,
        summary_index: 0,
        delta: "Сначала про балкон",
      })
      expect(shown(1)).toBe("aiThinking.reasoning: Сначала про балкон")

      writes(1, "Балкон был заперт.")
      expect(shown(1)).toBe("Балкон был заперт.")
    })

    it("starts a node's display anew with its next call", () => {
      open()
      writing(1)

      // Fix-problems finds, then fixes: two calls of one node, one after the other.
      streams(1, { type: "response.created" }, [0, "findProblemsResult"])
      writes(1, '{"foundProblems":[]}', [0, "findProblemsResult"])
      streams(1, { type: "response.completed" }, [0, "findProblemsResult"])
      expect(shown(1), "what a call wrote stays until the next one").toBe('{"foundProblems":[]}')

      streams(1, { type: "response.created" }, [0, "fixProblemsResult"])
      expect(shown(1)).toBe("regeneration.dispatched")
      writes(1, "Исправленный текст.", [0, "fixProblemsResult"])
      expect(shown(1)).toBe("Исправленный текст.")
    })

    it("tells a node's next call without the engine announcing it", () => {
      open()
      writing(1)

      // Such an engine sends the text and the end of a call, nothing else.
      writes(1, '{"foundProblems":[]}', [0, "findProblemsResult"])
      streams(1, { type: "response.completed" }, [0, "findProblemsResult"])
      writes(1, "Исправленный текст.", [0, "fixProblemsResult"])

      expect(shown(1)).toBe("Исправленный текст.")
    })

    it("unfolds the next node once the first is done", () => {
      open()
      writing(1, 2)
      writes(2, "Боря спит.")

      writing(2, 3)

      expect(shown(2)).toBe("Боря спит.")
      expect(unfolded(3)).toBe(false)
    })

    it("stays folded once the user folds the first node, until they unfold the first again", () => {
      open()
      writing(1, 2)

      fireEvent.click(line(1))
      expect(unfolded(1)).toBe(false)
      writing(2, 3)
      expect(unfolded(2), "the list stays as the user left it").toBe(false)

      fireEvent.click(line(2))
      writing(3, 4)
      expect(unfolded(3), "and follows the run again").toBe(true)
    })

    it("keeps a node the user unfolded that way while it runs, and no longer", () => {
      open()
      writing(1, 2, 3)

      fireEvent.click(line(3))
      writing(1, 3, 4)
      expect([unfolded(1), unfolded(3), unfolded(4)]).toEqual([true, true, false])

      fireEvent.click(line(3))
      writing(3, 4)
      expect(unfolded(3), "folded by the user, though it is the first now").toBe(false)

      // The iteration runs again later in the run: it is a node like any other again.
      writing(4)
      writing(4, 3)
      writing(3)
      expect(unfolded(3)).toBe(true)
    })

    it("forgets what a node wrote once the node is done", () => {
      open()
      writing(1)
      writes(1, "Аня идёт домой.")

      writing()
      // The same iteration runs again, on an engine that does not announce its calls.
      writing(1)

      expect(shown(1)).toBe("regeneration.dispatched")
      writes(1, "Снова.")
      expect(shown(1)).toBe("Снова.")
    })
  })

  describe("when the user starts a run", () => {
    it("leaves a run that fails to the status it reports: no rejection goes unhandled", async () => {
      const unhandled: unknown[] = []
      const note = (reason: unknown) => unhandled.push(reason)
      process.on("unhandledRejection", note)
      try {
        startRun = () => Promise.reject(new Error("Stop was required"))
        open()

        fireEvent.click(screen.getByRole("button", { name: "regeneration.start" }))
        // Node reports a rejection nobody handled once the pending promise jobs have run.
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(unhandled).toEqual([])
      } finally {
        process.off("unhandledRejection", note)
      }
    })
  })
})
