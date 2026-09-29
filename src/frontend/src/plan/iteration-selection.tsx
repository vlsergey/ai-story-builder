import { trpc } from "@/ipcClient"
import { LOOP_TYPES, loopsAround } from "@shared/loop-iterations"
import type { PlanNodeStateBrief } from "@shared/plan-graph"
import { childPath, type NodePath, parsePath, ROOT_PATH } from "@shared/plan-node-path"
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react"

/**
 * Which iteration of each loop the user looks at. It is view state only:
 * choosing one writes nothing, and works while the loop is generating. A loop
 * is keyed with its own path, so an inner loop remembers its page separately
 * in every iteration of the outer one. An iteration is named by its key — a
 * for-each's index, a parallel loop's element hash — so a parallel loop's page
 * stays on its element when others are inserted before it.
 *
 * Until the user picks an iteration, the display follows the one a sequential
 * loop is generating; a new run follows again. A parallel loop runs several at
 * once and is not followed.
 */
interface IterationSelection {
  /** Whether the node definitions are loaded: until then a display path is not known. */
  ready: boolean
  /** The key of the iteration of loop `loopId` at `loopPath` on display. */
  selected(loopId: number, loopPath: NodePath): string
  /** The user picks an iteration; picking the one being generated follows the run again. */
  select(loopId: number, loopPath: NodePath, key: string): void
  /** The loop's iterations as its pager shows them; the display never names one it lacks. */
  showKeys(loopId: number, loopPath: NodePath, keys: string[]): void
  /** Where the node is shown: in every loop around it, the iteration on display. */
  displayPath(nodeId: number): NodePath
}

const IterationSelectionContext = createContext<IterationSelection | null>(null)

const keyOf = (loopId: number, loopPath: NodePath) => `${loopId}@${loopPath}`

export function IterationSelectionProvider({ children }: { children: ReactNode }) {
  const definitions = trpc.plan.nodes.findAll.useQuery(undefined, { refetchOnWindowFocus: false }).data
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [followed, setFollowed] = useState<Record<string, string>>({})
  const [known, setKnown] = useState<Record<string, string[]>>({})
  const wasRunning = useRef(false)

  trpc.plan.nodes.aiGenerate.subscribeToStatusEvents.useSubscription(undefined, {
    onData(event) {
      // A new run follows its iterations again.
      if (event.inProcess && !wasRunning.current) setPicked({})
      wasRunning.current = event.inProcess
      const running: Record<string, string> = {}
      for (const item of event.currentRegenerationStack) {
        if (item.type !== "iteration" || item.container.type !== "for-each") continue
        running[keyOf(item.container.id, item.container.path)] = item.key ?? String(item.zeroBasedIterationIndex)
      }
      setFollowed((previous) =>
        Object.entries(running).every(([key, value]) => previous[key] === value)
          ? previous
          : { ...previous, ...running },
      )
    },
  })

  const loopsOf = useMemo(() => {
    const byId = new Map((definitions ?? []).map((n) => [n.id, n]))
    const cache = new Map<number, number[]>()
    return (nodeId: number): number[] => {
      let loops = cache.get(nodeId)
      if (!loops) {
        loops = loopsAround(nodeId, (id) => byId.get(id))
        cache.set(nodeId, loops)
      }
      return loops
    }
  }, [definitions])

  const selected = useCallback(
    (loopId: number, loopPath: NodePath) => {
      const loop = keyOf(loopId, loopPath)
      const keys = known[loop]
      const fits = (key: string | undefined) => key !== undefined && (!keys || keys.includes(key))
      if (fits(picked[loop])) return picked[loop]
      if (fits(followed[loop])) return followed[loop]
      return keys?.[0] ?? "0"
    },
    [picked, followed, known],
  )
  const select = useCallback(
    (loopId: number, loopPath: NodePath, key: string) => {
      const loop = keyOf(loopId, loopPath)
      setPicked(({ [loop]: _, ...rest }) => (followed[loop] === key ? rest : { ...rest, [loop]: key }))
    },
    [followed],
  )
  const showKeys = useCallback((loopId: number, loopPath: NodePath, keys: string[]) => {
    const loop = keyOf(loopId, loopPath)
    setKnown((previous) =>
      previous[loop]?.length === keys.length && previous[loop].every((key, i) => key === keys[i])
        ? previous
        : { ...previous, [loop]: keys },
    )
  }, [])
  const displayPath = useCallback(
    (nodeId: number) => {
      let path = ROOT_PATH
      for (const loop of loopsOf(nodeId)) path = childPath(path, loop, selected(loop, path))
      return path
    },
    [loopsOf, selected],
  )

  const value = useMemo(
    () => ({ ready: definitions !== undefined, selected, select, showKeys, displayPath }),
    [definitions, selected, select, showKeys, displayPath],
  )
  return <IterationSelectionContext.Provider value={value}>{children}</IterationSelectionContext.Provider>
}

export function useIterationSelection(): IterationSelection {
  const selection = useContext(IterationSelectionContext)
  if (!selection) throw new Error("useIterationSelection must be used inside IterationSelectionProvider")
  return selection
}

/**
 * What the graph shows of a node: its state in the iteration on display.
 * `state` is undefined while the node has produced nothing there.
 */
export function useNodeDisplayState(nodeId: number): { path: NodePath; state: PlanNodeStateBrief | undefined } {
  const path = useIterationSelection().displayPath(nodeId)
  const states = trpc.plan.nodes.findStatesAtPath.useQuery(path, { refetchOnWindowFocus: false }).data
  const state = useMemo(() => states?.find((s) => s.node_id === nodeId), [states, nodeId])
  return { path, state }
}

/**
 * An iteration as people count: `#3`, or `#2/#1` inside nested loops; a
 * parallel loop's iteration by the start of its key. Empty outside loops.
 */
export function iterationLabel(path: NodePath): string {
  return parsePath(path)
    .map((segment) => (/^\d+$/.test(segment.key) ? `#${Number(segment.key) + 1}` : `#${segment.key.slice(0, 6)}`))
    .join("/")
}

export { LOOP_TYPES }
