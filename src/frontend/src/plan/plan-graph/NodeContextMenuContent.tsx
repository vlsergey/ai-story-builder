import React, { useMemo } from "react"
import {
  ContextMenuContent as UIContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuGroup,
  ContextMenuSubContent,
} from "@/ui-components/context-menu"
import type { PlanNodeRow } from "@shared/plan-graph"
import { getNodeTypeDefinition } from "@shared/node-edge-dictionary"
import { useTranslation } from "react-i18next"
import NodeTypeIcons from "./NodeTypeIcons"
import { ExternalLink, TrashIcon, SaveIcon } from "lucide-react"
import { trpc } from "@/ipcClient"

interface NodeContextMenuContentProps {
  contextMenuNodeId: number
  serverNodes: PlanNodeRow[] | undefined
  aiGenerateSummary: (nodeId: number) => void
  deleteNode: (nodeId: number) => void
  moveNode: (nodeId: number, parentId: number | null) => void
  saveToFile: (nodeId: number) => void
}

export default function NodeContextMenuContent({
  contextMenuNodeId,
  serverNodes,
  aiGenerateSummary,
  deleteNode,
  moveNode,
  saveToFile,
}: NodeContextMenuContentProps) {
  const { t } = useTranslation()
  const contextMenuNode = useMemo(
    () => serverNodes?.find((n) => n.id === contextMenuNodeId),
    [serverNodes, contextMenuNodeId],
  )
  const nodeType = contextMenuNode?.type
  const nodeDef = nodeType ? getNodeTypeDefinition(nodeType) : null
  const regenerateNode = trpc.plan.nodes.aiGenerate.startForNode.useMutation().mutate

  return (
    <UIContextMenuContent>
      {nodeDef?.canRegenerate && (
        <ContextMenuItem
          onSelect={() => {
            regenerateNode(contextMenuNodeId)
          }}
        >
          {t("planGraph.nodeContextMenu.regenerate")}
        </ContextMenuItem>
      )}
      <ContextMenuItem
        onSelect={() => {
          aiGenerateSummary(contextMenuNodeId)
        }}
      >
        {t("planGraph.nodeContextMenu.aiGenerateSummary")}
      </ContextMenuItem>
      {nodeDef?.canSaveToFile && (
        <ContextMenuItem
          onSelect={() => {
            saveToFile(contextMenuNodeId)
          }}
        >
          <SaveIcon />
          {t("planGraph.nodeContextMenu.saveToFile")}
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuGroup>
        {!nodeDef?.confined && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <ExternalLink />
              {t("planGraph.nodeContextMenu.moveTo")}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {contextMenuNode?.parent_id != null && (
                <ContextMenuItem
                  key="null"
                  onSelect={() => {
                    moveNode(contextMenuNodeId, null)
                  }}
                >
                  {t("planGraph.nodeContextMenu.moveToRoot")}
                </ContextMenuItem>
              )}
              {serverNodes
                ?.filter((n) => n.id !== contextMenuNodeId)
                ?.filter((n) => n.type === "for-each")
                ?.filter((n) => n.id !== contextMenuNode?.parent_id)
                .map((n) => (
                  <ContextMenuItem
                    key={n.id}
                    onSelect={() => {
                      moveNode(contextMenuNodeId, n.id)
                    }}
                  >
                    {React.createElement(NodeTypeIcons[n.type])}
                    {n.title}
                  </ContextMenuItem>
                ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        {nodeDef?.canDelete && (
          <ContextMenuItem
            variant="destructive"
            onSelect={() => {
              deleteNode(contextMenuNodeId)
            }}
          >
            <TrashIcon />
            {t("planGraph.nodeContextMenu.delete")}
          </ContextMenuItem>
        )}
      </ContextMenuGroup>
    </UIContextMenuContent>
  )
}
