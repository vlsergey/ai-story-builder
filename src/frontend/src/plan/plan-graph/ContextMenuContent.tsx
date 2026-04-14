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
import { type PlanNodeRow } from "@shared/plan-graph"
import { getNodeTypeDefinition } from "@shared/node-edge-dictionary"
import { useLocale } from "@/lib/locale"
import NodeTypeIcons from "./NodeTypeIcons"
import { ExternalLink, TrashIcon } from "lucide-react"

interface ContextMenuContentProps {
  contextMenuNodeId: number
  serverNodes: PlanNodeRow[] | undefined
  aiGenerateSummary: (nodeId: number) => void
  deleteNode: (nodeId: number) => void
  moveNode: (nodeId: number, parentId: number | null) => void
  regenerateNode: (nodeId: number) => void
}

export default function ContextMenuContent({
  contextMenuNodeId,
  serverNodes,
  aiGenerateSummary,
  deleteNode,
  moveNode,
  regenerateNode,
}: ContextMenuContentProps) {
  const { t } = useLocale()
  const contextMenuNode = useMemo(
    () => serverNodes?.find((n) => n.id === contextMenuNodeId),
    [serverNodes, contextMenuNodeId],
  )
  const nodeType = contextMenuNode?.type
  const nodeDef = nodeType ? getNodeTypeDefinition(nodeType) : null

  return (
    <UIContextMenuContent>
      {nodeDef?.canRegenerate && (
        <ContextMenuItem
          onSelect={() => {
            regenerateNode(contextMenuNodeId)
          }}
        >
          {t("planGraph.contextMenu.regenerate")}
        </ContextMenuItem>
      )}
      <ContextMenuItem
        onSelect={() => {
          aiGenerateSummary(contextMenuNodeId)
        }}
      >
        {t("planGraph.contextMenu.aiGenerateSummary")}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        {!nodeDef?.confined && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <ExternalLink />
              {t("planGraph.contextMenu.moveTo")}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {contextMenuNode?.parent_id != null && (
                <ContextMenuItem
                  key="null"
                  onSelect={() => {
                    moveNode(contextMenuNodeId, null)
                  }}
                >
                  {t("planGraph.contextMenu.moveToRoot")}
                </ContextMenuItem>
              )}
              {serverNodes
                ?.filter((n) => n.id != contextMenuNodeId)
                ?.filter((n) => n.type === "for-each")
                ?.filter((n) => n.id != contextMenuNode?.parent_id)
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
            {t("planGraph.contextMenu.delete")}
          </ContextMenuItem>
        )}
      </ContextMenuGroup>
    </UIContextMenuContent>
  )
}
