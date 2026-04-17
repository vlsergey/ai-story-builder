import { useState, useEffect, useMemo } from "react"
import { useLocale } from "@/lib/locale"
import { trpc } from "@/ipcClient"
import { useTheme } from "@/lib/theme/theme-provider"
import { Button } from "@/ui-components/button"
import { Label } from "@/ui-components/label"
import { Switch } from "@/ui-components/switch"
import { Card, CardContent, CardHeader, CardTitle } from "@/ui-components/card"
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd"
import { GripVertical, SortAsc, SortDesc } from "lucide-react"
import CodeMirror, { EditorView } from "@uiw/react-codemirror"
import { markdown } from "@codemirror/lang-markdown"
import type TypedPlanNodeEditorProps from "./TypedPlanNodeEditorProps"
import type { MergeSettings } from "@shared/node-settings"

interface InputNode {
  edgeId: number
  sourceNodeId: number
  title: string
  content: string | null
  position: number
}

export default function MergeNodeEditor({
  dbValue,
  nodeTypeSettings,
  onChange,
  onRegenerate,
  onNodeTypeSettingsChange,
  value,
}: TypedPlanNodeEditorProps<MergeSettings>) {
  const { t } = useLocale()
  const { resolvedTheme } = useTheme()

  const inputEdges = trpc.plan.edges.findByToNodeId.useQuery(value.id).data
  const inputNodes = trpc.plan.nodes.getByIds.useQuery((inputEdges || []).map((t) => t.from_node_id)).data
  const serverInputs = useMemo<InputNode[]>(() => {
    return (inputEdges || [])
      .map((edge) => {
        const fromNode = (inputNodes || []).find((n) => n.id === edge.from_node_id)
        return fromNode
          ? {
              edgeId: edge.id,
              sourceNodeId: fromNode.id,
              title: fromNode.title,
              content: fromNode.content,
              position: edge.position,
            }
          : null
      })
      .filter((t) => t !== null)
  }, [inputEdges, inputNodes])

  const [inputs, setInputs] = useState<InputNode[]>([])
  useEffect(() => {
    setInputs(serverInputs)
  }, [serverInputs])

  const edgePatchMutation = trpc.plan.edges.patch.useMutation()

  // Handle drag end
  async function onDragEnd(result: DropResult) {
    if (!result.destination) return

    const items = Array.from(inputs)
    const [reorderedItem] = items.splice(result.source.index, 1)
    items.splice(result.destination.index, 0, reorderedItem)

    // Update positions
    const updatedItems = items.map((item, index) => ({
      ...item,
      position: index,
    }))

    setInputs(updatedItems)
    for (const item of updatedItems) {
      edgePatchMutation.mutate({ id: item.edgeId, data: { position: item.position } })
    }
  }

  // Sort inputs alphabetically
  async function sortAlphabetical(reverse = false) {
    const sorted = [...inputs].sort((a, b) => {
      const comparison = a.title.localeCompare(b.title)
      return reverse ? -comparison : comparison
    })

    const updated = sorted.map((item, index) => ({
      ...item,
      position: index,
    }))

    setInputs(updated)
    for (const item of updated) {
      edgePatchMutation.mutate({ id: item.edgeId, data: { position: item.position } })
    }
  }

  return (
    <div className="space-y-6 p-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("mergeNode.inputs")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-between items-center mb-3">
            <Button variant="outline" size="sm" onClick={() => sortAlphabetical(false)}>
              <SortAsc className="h-4 w-4 mr-2" />
              {t("mergeNode.sortAlphabetical")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => sortAlphabetical(true)}>
              <SortDesc className="h-4 w-4 mr-2" />
              {t("mergeNode.sortAlphabeticalReverse")}
            </Button>
          </div>

          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="inputs">
              {(provided) => (
                <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-2 min-h-[80px]">
                  {inputs.map((input, index) => (
                    <Draggable key={input.edgeId} draggableId={String(input.edgeId)} index={index}>
                      {(provided) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                          className="flex items-center gap-2 p-2 bg-muted rounded hover:bg-muted/70"
                        >
                          <GripVertical className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">{input.title}</span>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("mergeNode.options")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between py-2">
            <Label htmlFor="includeNodeTitle" className="text-sm mr-2">
              {t("mergeNode.includeNodeTitle")}
            </Label>
            <Switch
              id="includeNodeTitle"
              checked={nodeTypeSettings.includeNodeTitle}
              onCheckedChange={(checked: boolean) =>
                onNodeTypeSettingsChange({ ...nodeTypeSettings, includeNodeTitle: checked })
              }
              className="w-11 h-6 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input"
            />
          </div>

          <div className="flex items-center justify-between py-2">
            <Label htmlFor="includeInputTitles" className="text-sm mr-2">
              {t("mergeNode.includeInputTitles")}
            </Label>
            <Switch
              id="includeInputTitles"
              checked={nodeTypeSettings.includeInputTitles}
              onCheckedChange={(checked: boolean) =>
                onNodeTypeSettingsChange({ ...nodeTypeSettings, includeInputTitles: checked })
              }
              className="w-11 h-6 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input"
            />
          </div>

          <div className="flex items-center justify-between py-2">
            <Label htmlFor="fixHeaders" className="text-sm mr-2">
              {t("mergeNode.fixHeaders")}
            </Label>
            <Switch
              id="fixHeaders"
              checked={nodeTypeSettings.fixHeaders}
              onCheckedChange={(checked: boolean) =>
                onNodeTypeSettingsChange({ ...nodeTypeSettings, fixHeaders: checked })
              }
              className="w-11 h-6 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input"
            />
          </div>

          <div className="flex items-center justify-between py-2">
            <Label htmlFor="autoUpdate" className="text-sm mr-2">
              {t("mergeNode.autoUpdate")}
            </Label>
            <Switch
              id="autoUpdate"
              checked={nodeTypeSettings.autoUpdate}
              onCheckedChange={(checked: boolean) =>
                onNodeTypeSettingsChange({ ...nodeTypeSettings, autoUpdate: checked })
              }
              className="w-11 h-6 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input"
            />
          </div>

          {!nodeTypeSettings.autoUpdate && (
            <Button onClick={() => onRegenerate({ regenerateManual: true })} className="w-full">
              {t("common.update")}
            </Button>
          )}
        </CardContent>
      </Card>

      {nodeTypeSettings.autoUpdate ? (
        <CodeMirror
          value={dbValue.content || ""}
          height="80vh"
          extensions={[markdown(), EditorView.lineWrapping]}
          theme={resolvedTheme === "obsidian" ? "dark" : "light"}
          className="border rounded"
          readOnly={true}
        />
      ) : (
        <CodeMirror
          value={value.content || ""}
          height="80vh"
          extensions={[markdown(), EditorView.lineWrapping]}
          theme={resolvedTheme === "obsidian" ? "dark" : "light"}
          className="border rounded"
          onChange={(content) => {
            onChange({ ...value, content })
          }}
        />
      )}
    </div>
  )
}
