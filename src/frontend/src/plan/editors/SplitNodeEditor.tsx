import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/ui-components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/ui-components/card"
import { Textarea } from "@/ui-components/textarea"
import type TypedPlanNodeEditorProps from "./TypedPlanNodeEditorProps"
import type { SplitSettings } from "@shared/node-settings"

export default function SplitNodeEditor({
  nodeTypeSettings,
  onNodeTypeSettingsChange,
  onRegenerate,
  value,
}: TypedPlanNodeEditorProps<SplitSettings>) {
  const { t } = useTranslation()

  const parts = useMemo<string[]>(() => {
    const content = value.content
    if (!content) return []
    try {
      const parsed = JSON.parse(content)
      return Array.isArray(parsed) ? parsed.filter((p) => typeof p === "string") : []
    } catch {
      return []
    }
  }, [value.content])

  return (
    <div className="space-y-6 p-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("splitNode.settings")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("splitNode.promptHint")}</p>
          <Textarea
            value={nodeTypeSettings.userPrompt ?? ""}
            onChange={(e) =>
              onNodeTypeSettingsChange({
                ...nodeTypeSettings,
                userPrompt: e.currentTarget.value,
              })
            }
            placeholder={t("splitNode.promptPlaceholder")}
            rows={4}
            className="resize-y"
          />
          <Button onClick={onRegenerate} className="w-full">
            {t("common.update")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {t("splitNode.parts")} ({parts.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {parts.map((part, index) => (
              <div key={index} className="p-2 border rounded">
                <div className="text-sm text-muted-foreground whitespace-pre-wrap max-h-20 overflow-y-auto">{part}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
