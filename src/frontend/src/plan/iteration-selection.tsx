import { trpc } from "@/ipcClient"
import { LOOP_TYPES, loopsAround } from "@shared/loop-iterations"
import type { PlanNodeStateBrief } from "@shared/plan-graph"
import { childPath, type NodePath, parsePath, ROOT_PATH } from "@shared/plan-node-path"
import type { PlanNodeType } from "@shared/plan-node-types"
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react"

/**
 * Which iteration of each loop the user looks at. It is view state only:
 * choosing one writes nothing, and works while the loop is generating. A loop
 * is keyed with its own path, so an inner loop remembers its page separately
 * in every iteration of the outer one. An iteration is named by its key — a
 * for-each's index, a parallel loop's element hash — so a parallel loop's page
 * stays on its element when others are inserted before it.
 *
 * Until the user picks an iteration, the display follows a sequential loop to
 * the earliest of its iterations not done yet — iterations that do not read
 * the ones before them run side by side; a new run follows again. A parallel
 * loop is not followed: it has no order to follow.
 */
interface IterationSelection {
  /** Whether the node definitions are loaded: until then a display path is not known. */
  ready: boolean
  /** The key of the iteration of loop `loopId` at `loopPath` on display. */
  selected(loopId: number, loopPath: NodePath): string
  /** The user picks an iteration; picking the one being generated follows the run again. */
  select(loopId: number, loopPath: NodePath, key: string): void
  /** The iterations of the loop being generated right now. */
  running(loopId: number, loopPath: NodePath): readonly string[]
  /** The loop's iterations as its pager shows them; the display never names one it lacks. */
  showKeys(loopId: number, loopPath: NodePath, keys: string[]): void
  /** Where the node is shown: in every loop around it, the iteration on display. */
  displayPath(nodeId: number): NodePath
  /** The iteration as people name it — see `iterationLabel` — knowing each loop's kind. */
  labelOf(path: NodePath): string
}

const IterationSelectionContext = createContext<IterationSelection | null>(null)

const keyOf = (loopId: number, loopPath: NodePath) => `${loopId}@${loopPath}`

const NOTHING: readonly string[] = []

export function IterationSelectionProvider({ children }: { children: ReactNode }) {
  const definitions = trpc.plan.nodes.findAll.useQuery(undefined, { refetchOnWindowFocus: false }).data
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [followed, setFollowed] = useState<Record<string, string>>({})
  const [known, setKnown] = useState<Record<string, string[]>>({})
  const [runningKeys, setRunningKeys] = useState<Record<string, string[]>>({})
  const wasRunning = useRef(false)

  trpc.plan.nodes.aiGenerate.subscribeToStatusEvents.useSubscription(undefined, {
    onData(event) {
      // A new run follows the iterations of sequential loops again; a
      // parallel loop is never followed, so its page stays where it was.
      if (event.inProcess && !wasRunning.current) {
        setPicked((previous) =>
          Object.fromEntries(
            Object.entries(previous).filter(([loop]) => typeOf(Number.parseInt(loop, 10)) !== "for-each"),
          ),
        )
      }
      wasRunning.current = event.inProcess
      // The iterations that run now, per loop, read off the paths of the nodes being written.
      const allRunning: Record<string, string[]> = {}
      for (const { node } of event.running) {
        let loopPath = ROOT_PATH
        for (const segment of parsePath(node.path)) {
          const loop = keyOf(segment.containerId, loopPath)
          const keys = allRunning[loop] ?? []
          if (!keys.includes(segment.key)) allRunning[loop] = [...keys, segment.key]
          loopPath = childPath(loopPath, segment.containerId, segment.key)
        }
      }
      // A sequential loop is followed at the earliest of its iterations not
      // done yet: it stays put while that iteration's nodes take turns.
      const running: Record<string, string> = {}
      for (const loop of event.loops) {
        if (loop.node.type === "for-each") running[keyOf(loop.node.id, loop.node.path)] = loop.current
      }
      setRunningKeys((previous) => (JSON.stringify(previous) === JSON.stringify(allRunning) ? previous : allRunning))
      setFollowed((previous) =>
        Object.entries(running).every(([key, value]) => previous[key] === value)
          ? previous
          : { ...previous, ...running },
      )
    },
  })

  const byId = useMemo(() => new Map((definitions ?? []).map((n) => [n.id, n])), [definitions])
  const typeOf = useCallback((id: number): PlanNodeType | undefined => byId.get(id)?.type, [byId])
  const loopsOf = useMemo(() => {
    const cache = new Map<number, number[]>()
    return (nodeId: number): number[] => {
      let loops = cache.get(nodeId)
      if (!loops) {
        loops = loopsAround(nodeId, (id) => byId.get(id))
        cache.set(nodeId, loops)
      }
      return loops
    }
  }, [byId])

  const selected = useCallback(
    (loopId: number, loopPath: NodePath) => {
      const loop = keyOf(loopId, loopPath)
      const keys = known[loop]
      // A key the loop no longer names may have grown: a parallel loop's
      // longer key starts with it.
      const named = (key: string | undefined) => {
        if (key === undefined || !keys || keys.includes(key)) return key
        const grown = keys.filter((known) => known.startsWith(key))
        return grown.length === 1 ? grown[0] : undefined
      }
      return named(picked[loop]) ?? named(followed[loop]) ?? keys?.[0] ?? "0"
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

  const running = useCallback(
    (loopId: number, loopPath: NodePath) => runningKeys[keyOf(loopId, loopPath)] ?? NOTHING,
    [runningKeys],
  )

  const labelOf = useCallback((path: NodePath) => iterationLabel(path, typeOf), [typeOf])

  const value = useMemo(
    () => ({ ready: definitions !== undefined, selected, select, running, showKeys, displayPath, labelOf }),
    [definitions, selected, select, running, showKeys, displayPath, labelOf],
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
  const states = trpc.plan.nodes.findStatesAtPath.useQuery({ path }, { refetchOnWindowFocus: false }).data
  const state = useMemo(() => states?.find((s) => s.node_id === nodeId), [states, nodeId])
  return { path, state }
}

/**
 * An iteration as people name it: a sequential loop's by its number, from one
 * (`#3`); a parallel loop's by the start of its key (`#a3f9c1`); `#2/#a3f9c1`
 * inside nested loops. Empty outside loops. Without `typeOf` a key is told
 * from an index by its length: a key has six characters at least, and no
 * sequential loop runs a hundred thousand times.
 */
export function iterationLabel(path: NodePath, typeOf?: (containerId: number) => PlanNodeType | undefined): string {
  return parsePath(path)
    .map((segment) => {
      const type = typeOf?.(segment.containerId)
      const isIndex = type ? type === "for-each" : /^\d{1,5}$/.test(segment.key)
      return isIndex ? `#${Number(segment.key) + 1}` : `#${segment.key.slice(0, 6)}`
    })
    .join("/")
}

export { LOOP_TYPES }
