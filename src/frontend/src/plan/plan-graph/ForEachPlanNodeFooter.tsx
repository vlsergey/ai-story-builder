import PaginationWrapper from "@/lib/PaginationWrapper"
import type { NodePath } from "@shared/plan-node-path"
import { useCallback, useEffect, useMemo } from "react"
import { useIterationSelection } from "../iteration-selection"

interface ForEachPlanNodeFooterProps {
  loopId: number
  /** The loop's own path: where it runs, in the iterations of the loops around it. */
  path: NodePath
  /** The loop's iterations, in order, by the keys its children's paths use. */
  iterationKeys: string[]
}

/**
 * Pages through a loop's iterations. Choosing one only changes what the graph
 * shows — nothing is written, and it works while the loop is generating.
 */
export default function ForEachPlanNodeFooter({ loopId, path, iterationKeys }: ForEachPlanNodeFooterProps) {
  const { selected, select, running, showKeys } = useIterationSelection()
  const runningKeys = running(loopId, path)
  const runningPages = useMemo(
    () => new Set(runningKeys.map((key) => iterationKeys.indexOf(key)).filter((page) => page >= 0)),
    [runningKeys, iterationKeys],
  )
  useEffect(() => showKeys(loopId, path, iterationKeys), [loopId, path, iterationKeys, showKeys])

  const handlePageChange = useCallback(
    ({ target: { value } }: { target: { value: number } }) => {
      const key = iterationKeys[value]
      if (key !== undefined) select(loopId, path, key)
    },
    [iterationKeys, loopId, path, select],
  )

  return (
    <div className="for-each-plan-node-footer">
      <PaginationWrapper
        disabled={false}
        page={Math.max(0, iterationKeys.indexOf(selected(loopId, path)))}
        onPageChange={handlePageChange}
        totalPages={iterationKeys.length}
        markedPages={runningPages}
      />
    </div>
  )
}
