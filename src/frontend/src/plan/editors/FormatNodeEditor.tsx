import type { FormatSettings } from "@shared/node-settings"
import { useId } from "react"
import { useTranslation } from "react-i18next"
import { trpc } from "@/ipcClient"
import { Button } from "@/ui-components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/ui-components/card"
import { Input } from "@/ui-components/input"
import { Label } from "@/ui-components/label"
import { Switch } from "@/ui-components/switch"
import { Textarea } from "@/ui-components/textarea"
import type TypedPlanNodeEditorProps from "./TypedPlanNodeEditorProps"

/** The mask a page is saved under until its settings name another: the backend's default. */
const DEFAULT_FILE_NAME = "{{projectFile}}.html"

/** What a file name mask can name, each shown with what it stands for. */
const MASK_VARIABLES = ["projectFile", "projectName", "title"] as const

/**
 * A page laid out from the node's inputs: its template, and whether each
 * rebuild also saves it next to the project file, under what name.
 */
export default function FormatNodeEditor({
  nodeTypeSettings,
  onNodeTypeSettingsChange,
  onRegenerate,
  value,
}: TypedPlanNodeEditorProps<FormatSettings>) {
  const { t } = useTranslation()
  const saveId = useId()
  const fileNameId = useId()
  const fileName = nodeTypeSettings.fileName ?? DEFAULT_FILE_NAME
  // Every iteration of a loop would overwrite the same file.
  const insideLoop = value.path !== ""
  const target = trpc.plan.nodes.savedPageTarget.useQuery(
    { id: value.id, fileName },
    { keepPreviousData: true, refetchOnWindowFocus: false },
  ).data
  const change = (patch: Partial<FormatSettings>) => onNodeTypeSettingsChange({ ...nodeTypeSettings, ...patch })

  const preview = !target
    ? ""
    : target.error
      ? t("formatNode.fileNameInvalid", { error: target.error })
      : !target.name
        ? t("formatNode.fileNameEmpty")
        : target.folder
          ? t("formatNode.fileNamePreview", { name: target.name, folder: target.folder })
          : t("formatNode.fileNameNoFolder", { name: target.name })

  return (
    <div className="space-y-6 p-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("formatNode.file")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Switch
              id={saveId}
              checked={!!nodeTypeSettings.saveNextToProject}
              disabled={insideLoop}
              onCheckedChange={(checked) => change({ saveNextToProject: checked })}
            />
            <Label htmlFor={saveId}>{t("formatNode.saveNextToProject")}</Label>
          </div>
          {insideLoop && <p className="text-sm text-muted-foreground">{t("formatNode.insideLoop")}</p>}
          <div className="space-y-2">
            <Label htmlFor={fileNameId}>{t("formatNode.fileName")}</Label>
            <Input
              id={fileNameId}
              value={fileName}
              onChange={(e) => change({ fileName: e.currentTarget.value })}
              className="font-mono"
            />
            <p className="text-sm text-muted-foreground" data-testid="saved-page-preview">
              {preview}
            </p>
            <ul className="text-xs text-muted-foreground space-y-0.5">
              {MASK_VARIABLES.map((variable) => (
                <li key={variable}>
                  <code>{`{{${variable}}}`}</code> — {t(`formatNode.maskVariable.${variable}`)}
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("formatNode.template")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("formatNode.templateHint", { example: `{{[${t("formatNode.templateHintExample")}]}}` })}
          </p>
          <Textarea
            value={nodeTypeSettings.template ?? ""}
            onChange={(e) => change({ template: e.currentTarget.value })}
            rows={16}
            className="resize-y font-mono text-xs"
          />
          <Button onClick={onRegenerate} className="w-full">
            {t("common.update")}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
