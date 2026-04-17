import { trpc } from "@/ipcClient"
import { useLocale } from "@/lib/locale"
import { useTheme } from "@/lib/theme/theme-provider"
import { Button } from "@/ui-components/button"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/ui-components/field"
import { Input } from "@/ui-components/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui-components/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui-components/tabs"
import { json } from "@codemirror/lang-json"
import { markdown } from "@codemirror/lang-markdown"
import type { FixProblemsPlanNodeContent, FixProblemsPlanNodeSettings } from "@shared/fix-problems-plan-node"
import CodeMirror, { EditorView } from "@uiw/react-codemirror"
import { useId, useMemo } from "react"
import type TypedPlanNodeEditorProps from "./TypedPlanNodeEditorProps"
import { Textarea } from "@/ui-components/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui-components/tooltip"
import { CircleQuestionMarkIcon } from "lucide-react"

interface InputNode {
  edgeId: number
  sourceNodeId: number
  title: string
  position: number
}

export default function FixProblemsNodeEditor({
  dbValue,
  disabled,
  nodeTypeSettings,
  onRegenerate,
  onNodeTypeSettingsChange,
  value,
  onChange,
}: TypedPlanNodeEditorProps<FixProblemsPlanNodeSettings>) {
  const { t } = useLocale()
  const { resolvedTheme } = useTheme()

  const inputEdges = trpc.plan.edges.findByToNodeIdAndType.useQuery({ id: dbValue.id, type: "text" }).data
  const inputNodes = trpc.plan.nodes.getByIds.useQuery((inputEdges || []).map((t) => t.from_node_id)).data
  const inputs = useMemo<InputNode[]>(() => {
    return (inputEdges || [])
      .map((edge) => {
        const fromNode = (inputNodes || []).find((n) => n.id === edge.from_node_id)
        return fromNode
          ? {
              edgeId: edge.id,
              sourceNodeId: fromNode.id,
              title: fromNode.title,
              position: edge.position,
            }
          : null
      })
      .filter((t) => t !== null)
  }, [inputEdges, inputNodes])

  const content = useMemo(() => {
    return JSON.parse(dbValue.content || "{}") as FixProblemsPlanNodeContent
  }, [dbValue.content])

  const htmlIdTitle = useId()

  const htmlIdSourceNodeIdToFix = useId()
  const htmlIdMinSeverityToFix = useId()
  const htmlIdFoundProblemsTemplate = useId()
  const htmlIdMaxIterations = useId()

  const htmlIdAiSystemInstructionsToFindProblems = useId()
  const htmlIdAiSystemInstructionsToFixProblems = useId()
  const htmlIdAiUserInstructionsToFindProblems = useId()
  const htmlIdAiUserInstructionsToFixProblems = useId()

  return (
    <div className="p-2">
      <FieldGroup>
        <Field orientation="responsive">
          <FieldContent>
            <FieldLabel htmlFor={htmlIdTitle}>{t(`planNode.title.label`)}</FieldLabel>
            <FieldDescription>{t(`planNode.title.description`)}</FieldDescription>
          </FieldContent>
          <Input
            value={value.title}
            onChange={({ target: { value: newTitle } }) => onChange({ ...value, title: newTitle })}
            placeholder={`Node title`}
            aria-label={`Node title`}
          />
        </Field>

        <Field orientation="responsive">
          <FieldLabelAndDescription fieldKey="sourceNodeIdToFix" htmlIdFor={htmlIdSourceNodeIdToFix} />
          <Select
            disabled={disabled}
            value={nodeTypeSettings.sourceNodeIdToFix ? String(nodeTypeSettings.sourceNodeIdToFix) : undefined}
            onValueChange={(value) => {
              console.log("will call onNodeTypeSettingsChange with ", {
                ...nodeTypeSettings,
                sourceNodeIdToFix: Number(value),
              })
              onNodeTypeSettingsChange({ ...nodeTypeSettings, sourceNodeIdToFix: Number(value) })
            }}
          >
            <SelectTrigger id={htmlIdSourceNodeIdToFix}>
              <SelectValue placeholder={t("fixProblemsNode.sourceNodeIdToFix.label")} />
            </SelectTrigger>
            <SelectContent>
              {inputs.map(({ sourceNodeId, title }) => (
                <SelectItem key={sourceNodeId} value={String(sourceNodeId)}>
                  {`#${sourceNodeId}. ${title}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field orientation="responsive">
          <FieldLabelAndDescription fieldKey="minSeverityToFix" htmlIdFor={htmlIdMinSeverityToFix} />
          <Input
            disabled={disabled}
            min={0}
            max={100}
            type="number"
            id={htmlIdMinSeverityToFix}
            value={nodeTypeSettings.minSeverityToFix}
            onChange={({ target: { value } }) =>
              onNodeTypeSettingsChange({ ...nodeTypeSettings, minSeverityToFix: Number(value) })
            }
          />
        </Field>

        <Field orientation="responsive">
          <FieldLabelAndDescription fieldKey="foundProblemsTemplate" htmlIdFor={htmlIdFoundProblemsTemplate} />
          <Input
            disabled={disabled}
            id={htmlIdFoundProblemsTemplate}
            value={nodeTypeSettings.foundProblemsTemplate}
            onChange={({ target: { value } }) =>
              onNodeTypeSettingsChange({ ...nodeTypeSettings, foundProblemsTemplate: value })
            }
          />
        </Field>

        <Field orientation="responsive">
          <FieldLabelAndDescription fieldKey="maxIterations" htmlIdFor={htmlIdMaxIterations} />
          <Input
            disabled={disabled}
            min={1}
            type="number"
            id={htmlIdMaxIterations}
            value={nodeTypeSettings.maxIterations}
            onChange={({ target: { value } }) =>
              onNodeTypeSettingsChange({ ...nodeTypeSettings, maxIterations: Number(value) })
            }
          />
        </Field>

        <Tabs defaultValue="user">
          <TabsList variant="line">
            <TabsTrigger value="system">
              <Tooltip>
                <TooltipTrigger className="flex items-center gap-1">
                  {t("ai.systemInstructions")}
                  <CircleQuestionMarkIcon />
                </TooltipTrigger>
                <TooltipContent>{t("ai.systemInstructions.description")}</TooltipContent>
              </Tooltip>
            </TabsTrigger>
            <TabsTrigger value="user">
              <Tooltip>
                <TooltipTrigger className="flex items-center gap-1">
                  {t("ai.userInstructions")}
                  <CircleQuestionMarkIcon />
                </TooltipTrigger>
                <TooltipContent>{t("ai.userInstructions.description")}</TooltipContent>
              </Tooltip>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="system">
            <div className="w-full flex gap-2">
              <div className="flex-1">
                <Field orientation="vertical">
                  <FieldLabelAndDescription
                    fieldKey="aiSystemInstructionsToFindProblems"
                    htmlIdFor={htmlIdAiSystemInstructionsToFindProblems}
                  />
                  <Textarea
                    disabled={disabled}
                    id={htmlIdAiSystemInstructionsToFindProblems}
                    value={nodeTypeSettings.aiSystemInstructionsToFindProblems}
                    onChange={({ target: { value: aiSystemInstructionsToFindProblems } }) =>
                      onNodeTypeSettingsChange({ ...nodeTypeSettings, aiSystemInstructionsToFindProblems })
                    }
                  />
                </Field>
              </div>
              <div className="flex-1">
                <Field orientation="vertical">
                  <FieldLabelAndDescription
                    fieldKey="aiSystemInstructionsToFixProblems"
                    htmlIdFor={htmlIdAiSystemInstructionsToFixProblems}
                  />
                  <Textarea
                    disabled={disabled}
                    id={htmlIdAiSystemInstructionsToFixProblems}
                    value={nodeTypeSettings.aiSystemInstructionsToFixProblems}
                    onChange={({ target: { value: aiSystemInstructionsToFixProblems } }) =>
                      onNodeTypeSettingsChange({ ...nodeTypeSettings, aiSystemInstructionsToFixProblems })
                    }
                  />
                </Field>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="user">
            <div className="w-full flex gap-2">
              <div className="flex-1">
                <Field orientation="vertical">
                  <FieldLabelAndDescription
                    fieldKey="aiUserInstructionsToFindProblems"
                    htmlIdFor={htmlIdAiUserInstructionsToFindProblems}
                  />
                  <Textarea
                    disabled={disabled}
                    id={htmlIdAiUserInstructionsToFindProblems}
                    value={nodeTypeSettings.aiUserInstructionsToFindProblems}
                    onChange={({ target: { value: aiUserInstructionsToFindProblems } }) =>
                      onNodeTypeSettingsChange({ ...nodeTypeSettings, aiUserInstructionsToFindProblems })
                    }
                  />
                </Field>
              </div>
              <div className="flex-1">
                <Field orientation="vertical">
                  <FieldLabelAndDescription
                    fieldKey="aiUserInstructionsToFixProblems"
                    htmlIdFor={htmlIdAiUserInstructionsToFixProblems}
                  />
                  <Textarea
                    disabled={disabled}
                    id={htmlIdAiUserInstructionsToFixProblems}
                    value={nodeTypeSettings.aiUserInstructionsToFixProblems}
                    onChange={({ target: { value: aiUserInstructionsToFixProblems } }) =>
                      onNodeTypeSettingsChange({ ...nodeTypeSettings, aiUserInstructionsToFixProblems })
                    }
                  />
                </Field>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <Button disabled={disabled} onClick={() => onRegenerate({ regenerateManual: true })}>
          {t("common.update")}
        </Button>
      </FieldGroup>

      <Tabs defaultValue="0">
        <TabsList variant="line">
          {(content.iterations || []).map((iteration, index) => (
            <TabsTrigger key={index} value={String(index)}>
              <span>#{index + 1}. </span>
              <span className="text-sm text-muted-foreground" title="Found problems">
                {iteration.findProblemsResult?.foundProblems.length};{" "}
              </span>
              <span className="text-sm text-muted-foreground" title="Max severity">
                {iteration.findProblemsResult?.foundProblems.reduce(
                  (acc, problem) => Math.max(acc, problem.severity),
                  0,
                )}
                {"."}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        {(content.iterations || []).map((iteration, index) => (
          <TabsContent key={index} value={String(index)}>
            <div className="h-75 w-full flex">
              <div className="flex-1 h-full">
                <CodeMirror
                  value={JSON.stringify(iteration.findProblemsResult || {}, undefined, 2)}
                  extensions={[json(), EditorView.lineWrapping]}
                  theme={resolvedTheme === "obsidian" ? "dark" : "light"}
                  className="border rounded"
                  readOnly={true}
                />
              </div>
              <div className="flex-1 h-full">
                <CodeMirror
                  value={iteration.fixProblemsResult}
                  extensions={[markdown(), EditorView.lineWrapping]}
                  theme={resolvedTheme === "obsidian" ? "dark" : "light"}
                  className="border rounded"
                  readOnly={true}
                />
              </div>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}

function FieldLabelAndDescription({ fieldKey, htmlIdFor }: { fieldKey: string; htmlIdFor: string }) {
  const { t } = useLocale()

  return (
    <FieldContent>
      <FieldLabel htmlFor={htmlIdFor}>{t(`fixProblemsNode.${fieldKey}.label`)}</FieldLabel>
      <FieldDescription>{t(`fixProblemsNode.${fieldKey}.description`)}</FieldDescription>
    </FieldContent>
  )
}
