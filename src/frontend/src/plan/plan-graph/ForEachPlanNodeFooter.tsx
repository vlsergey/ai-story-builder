import PaginationWrapper from "@/lib/PaginationWrapper"
import type { NodePath } from "@shared/plan-node-path"
import { useCallback } from "react"
import { useIterationSelection } from "../iteration-selection"

interface ForEachPlanNodeFooterProps {
  loopId: number
  /** The loop's own path: where it runs, in the iterations of the loops around it. */
  path: NodePath
  iterations: number
}

/**
 * Pages through a loop's iterations. Choosing one only changes what the graph
 * shows — nothing is written, and it works while the loop is generating.
 */
export default function ForEachPlanNodeFooter({ loopId, path, iterations }: ForEachPlanNodeFooterProps) {
  const { selected, select } = useIterationSelection()
  const handlePageChange = useCallback(
    ({ target: { value } }: { target: { value: number } }) => select(loopId, path, value),
    [loopId, path, select],
  )

  return (
    <div className="for-each-plan-node-footer">
      <PaginationWrapper
        disabled={false}
        page={Math.min(selected(loopId, path), Math.max(iterations - 1, 0))}
        onPageChange={handlePageChange}
        totalPages={iterations}
      />
    </div>
  )
}
