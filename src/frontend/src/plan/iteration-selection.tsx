import { trpc } from "@/ipcClient"
import type { PlanNodeStateBrief } from "@shared/plan-graph"
import { childPath, type NodePath, parsePath, ROOT_PATH } from "@shared/plan-node-path"
import { PLAN_CONTAINER_NODE_TYPE_VALUES, type PlanNodeType } from "@shared/plan-node-types"
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react"

/**
 * Which iteration of each loop the user looks at. It is view state only:
 * choosing one writes nothing, and works while the loop is generating. A loop
 * is keyed with its own path, so an inner loop remembers its page separately
 * in every iteration of the outer one.
 *
 * Until the user picks an iteration, the display follows the one being
 * generated; once they pick, it stays.
 */
interface IterationSelection {
  /** The iteration of loop `loopId` at `loopPath` on display. */
  selected(loopId: number, loopPath: NodePath): number
  select(loopId: number, loopPath: NodePath, index: number): void
  /** Where the node is shown: in every loop around it, the iteration on display. */
  displayPath(nodeId: number): NodePath
}

const IterationSelectionContext = createContext<IterationSelection | null>(null)

const LOOP_TYPES: ReadonlySet<PlanNodeType> = new Set(PLAN_CONTAINER_NODE_TYPE_VALUES)

const keyOf = (loopId: number, loopPath: NodePath) => `${loopId}@${loopPath}`

export function IterationSelectionProvider({ children }: { children: ReactNode }) {
  const definitions = trpc.plan.nodes.findAll.useQuery(undefined, { refetchOnWindowFocus: false }).data
  const [picked, setPicked] = useState<Record<string, number>>({})
  const [followed, setFollowed] = useState<Record<string, number>>({})

  trpc.plan.nodes.aiGenerate.subscribeToStatusEvents.useSubscription(undefined, {
    onData(event) {
      const running: Record<string, number> = {}
      for (const item of event.currentRegenerationStack) {
        if (item.type === "iteration") {
          running[keyOf(item.container.id, item.container.path)] = item.zeroBasedIterationIndex
        }
      }
      setFollowed((previous) =>
        Object.entries(running).every(([key, index]) => previous[key] === index)
          ? previous
          : { ...previous, ...running },
      )
    },
  })

  const loopsAround = useMemo(() => {
    const byId = new Map((definitions ?? []).map((n) => [n.id, n]))
    const cache = new Map<number, number[]>()
    return (nodeId: number): number[] => {
      let loops = cache.get(nodeId)
      if (loops) return loops
      loops = []
      for (let p = byId.get(nodeId)?.parent_id ?? null; p !== null; p = byId.get(p)?.parent_id ?? null) {
        const parent = byId.get(p)
        if (!parent) break
        if (LOOP_TYPES.has(parent.type)) loops.unshift(parent.id)
      }
      cache.set(nodeId, loops)
      return loops
    }
  }, [definitions])

  const selected = useCallback(
    (loopId: number, loopPath: NodePath) => picked[keyOf(loopId, loopPath)] ?? followed[keyOf(loopId, loopPath)] ?? 0,
    [picked, followed],
  )
  const select = useCallback((loopId: number, loopPath: NodePath, index: number) => {
    setPicked((previous) => ({ ...previous, [keyOf(loopId, loopPath)]: index }))
  }, [])
  const displayPath = useCallback(
    (nodeId: number) => {
      let path = ROOT_PATH
      for (const loop of loopsAround(nodeId)) path = childPath(path, loop, selected(loop, path))
      return path
    },
    [loopsAround, selected],
  )

  const value = useMemo(() => ({ selected, select, displayPath }), [selected, select, displayPath])
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

/** An iteration as people count: `#3`, or `#2/#1` inside nested loops. Empty outside loops. */
export function iterationLabel(path: NodePath): string {
  return parsePath(path)
    .map((segment) => `#${Number(segment.key) + 1}`)
    .join("/")
}
