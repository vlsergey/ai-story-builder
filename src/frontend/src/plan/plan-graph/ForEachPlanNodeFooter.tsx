import { trpc } from "@/ipcClient";
import PaginationWrapper from "@/lib/PaginationWrapper";
import { ForEachNodeContent } from "@shared/for-each-plan-node";
import { PlanNodeRow } from "@shared/plan-graph";
import { useCallback, useMemo } from "react";

interface ForEachPlanNodeFooterProps {
  node: PlanNodeRow
}

export default function ForEachPlanNodeFooter({
  node
}: ForEachPlanNodeFooterProps) {
  let parsedContent = useMemo(() => JSON.parse(node.content || '{}') as ForEachNodeContent, [node.content])

  const changePage = trpc.plan.nodes.forEachNodes.changePage.useMutation()
  const handlePageChange = useCallback(({target: {value}}: {target: {value: number}}) => {
    changePage.mutateAsync({nodeId: node.id, page: value})
  }, [changePage, node.id])

  return ( <div className="for-each-plan-node-footer">
    <PaginationWrapper
      disabled={changePage.isPending || node.status == 'GENERATING'}
      page={parsedContent.currentIndex || 0}
      onPageChange={handlePageChange}
      totalPages={parsedContent.length || 0}/>
  </div> )
}