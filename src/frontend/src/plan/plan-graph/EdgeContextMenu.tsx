import { trpc } from "@/ipcClient"
import { useTranslation } from "react-i18next"
import useConfirm from "@/native/useConfirm"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/ui-components/context-menu"
import type { PlanEdgeRow, PlanNodeRow } from "@shared/plan-graph"
import { LineDotRightHorizontalIcon, TrashIcon } from "lucide-react"
import { useCallback } from "react"

interface EdgeContextMenuProps {
  edgeData: {
    edge: PlanEdgeRow
    source: PlanNodeRow
    target: PlanNodeRow
  } | null
  triggerRef: React.RefObject<HTMLDivElement | null>
}

export default function EdgeContextMenu({ edgeData, triggerRef }: EdgeContextMenuProps) {
  const { t } = useTranslation()

  const deleteMutation = trpc.plan.edges.delete.useMutation()
  const confirm = useConfirm()

  const handleDelete = useCallback(async () => {
    if (edgeData?.edge === undefined) return

    const confirmed = await confirm("planGraph.edgeContextMenu.delete.confirm")
    if (!confirmed) return
    await deleteMutation.mutateAsync(edgeData.edge.id)
  }, [deleteMutation, confirm, edgeData?.edge])

  if (edgeData === null) {
    return null
  }
  const { edge, source, target } = edgeData

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div ref={triggerRef} className="fixed invisible" />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>
          {t("planGraph.edgeContextMenu.label")}
          {edge.id}
        </ContextMenuLabel>
        <ContextMenuLabel className="flex items-center gap-2">
          <LineDotRightHorizontalIcon className="w-4 h-4 -scale-x-100" />
          <span>{source.id}</span>
          <span>{source.title}</span>
        </ContextMenuLabel>
        <ContextMenuLabel className="flex items-center gap-2">
          <LineDotRightHorizontalIcon className="w-4 h-4" />
          <span>{target.id}</span>
          <span>{target.title}</span>
        </ContextMenuLabel>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleDelete} variant="destructive">
          <TrashIcon />
          {t("planGraph.edgeContextMenu.delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
