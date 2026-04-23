import { Button } from "@/ui-components/button"
import { ButtonGroup } from "@/ui-components/button-group"
import { getCreatableNodeTypes } from "@shared/node-edge-dictionary"
import type { PlanContainerNodeType, PlanNodeType } from "@shared/plan-graph"
import { useCallback, useState } from "react"
import { useMemo } from "react"
import NodeTypeIcons from "./NodeTypeIcons"
import { trpc } from "@/ipcClient"
import { useLocale } from "@/i18n/locale"
import AddNodeDialog from "./AddNodeDialog"

interface CreateNodeButtonGroupProps {
  compact?: boolean
  parentNode?: {
    type: PlanContainerNodeType
    id: number
  }
}

export default function CreateNodeButtonGroup({ compact, parentNode }: CreateNodeButtonGroupProps) {
  const { t } = useLocale()
  const [nodeTypeToCreate, setNodeTypeToCreate] = useState<PlanNodeType | null>(null)
  const [showAddDialog, setShowAddDialog] = useState<boolean>(false)

  function handleShowDialog(type: PlanNodeType) {
    setNodeTypeToCreate(type)
    setShowAddDialog(true)
  }

  const addNode = trpc.plan.nodes.create.useMutation().mutate

  const handleConfirm = useCallback(
    (title: string) => {
      if (!showAddDialog) return
      setShowAddDialog(false)
      const type = nodeTypeToCreate
      addNode({ type, title, x: 0, y: 0, parent_id: parentNode?.id })
    },
    [showAddDialog, nodeTypeToCreate, addNode, parentNode?.id],
  )

  const creatableNodeTypes = useMemo(() => getCreatableNodeTypes(parentNode?.type || "root"), [parentNode?.type])

  return (
    <ButtonGroup className="create-node-button-group">
      {creatableNodeTypes.map((nodeType) => {
        const Icon = NodeTypeIcons[nodeType]
        return (
          <Button
            variant="ghost"
            key={nodeType}
            onClick={() => handleShowDialog(nodeType)}
            title={t(`planGraph.addNode.${nodeType}`)}
          >
            <Icon />
            {!compact && t(`planGraph.addNode.${nodeType}`)}
          </Button>
        )
      })}

      <AddNodeDialog
        nodeType={nodeTypeToCreate ?? undefined}
        open={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        onConfirm={handleConfirm}
      />
    </ButtonGroup>
  )
}
