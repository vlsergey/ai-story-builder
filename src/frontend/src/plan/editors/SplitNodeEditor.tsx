import { useMemo } from "react"
import { useLocale } from "@/lib/locale"
import { Button } from "@/ui-components/button"
import { Label } from "@/ui-components/label"
import { Switch } from "@/ui-components/switch"
import { Card, CardContent, CardHeader, CardTitle } from "@/ui-components/card"
import type TypedPlanNodeEditorProps from "./TypedPlanNodeEditorProps"
import type { SplitSettings } from "@shared/node-settings"
import { Input } from "@/ui-components/input"

export default function SplitNodeEditor({
  dbValue,
  nodeTypeSettings,
  onNodeTypeSettingsChange,
  onRegenerate,
  value,
}: TypedPlanNodeEditorProps<SplitSettings>) {
  const { t } = useLocale()

  const parts = useMemo<string[]>(() => {
    const content = nodeTypeSettings.autoUpdate ? dbValue.content : value.content
    if (content) {
      try {
        const parsed = JSON.parse(content)
        if (Array.isArray(parsed)) {
          return parsed
        } else {
          return []
        }
      } catch {
        return []
      }
    } else {
      return []
    }
  }, [nodeTypeSettings.autoUpdate, dbValue.content, value.content])

  return (
    <div className="space-y-6 p-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("splitNode.settings")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="separator" className="text-sm">
              {t("splitNode.separator")}
            </Label>
            <input
              id="separator"
              value={nodeTypeSettings.separator}
              onChange={(e) => onNodeTypeSettingsChange({ ...nodeTypeSettings, separator: e.target.value })}
              className="w-full border rounded px-2 py-1 text-sm"
              placeholder={'e.g., "\\n\\n" or "\\\\s*---\\\\s*"'}
            />
          </div>

          <div className="flex items-center justify-between py-2">
            <Label htmlFor="autoUpdate" className="text-sm mr-2">
              {t("splitNode.autoUpdate")}
            </Label>
            <Switch
              id="autoUpdate"
              checked={nodeTypeSettings.autoUpdate}
              onCheckedChange={(checked: boolean) =>
                onNodeTypeSettingsChange({ ...nodeTypeSettings, autoUpdate: checked })
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="dropFirst" className="text-sm">
              {t("splitNode.dropFirst")}
            </Label>
            <Input
              type="number"
              min="0"
              value={nodeTypeSettings.dropFirst}
              onChange={(e) =>
                onNodeTypeSettingsChange({ ...nodeTypeSettings, dropFirst: parseInt(e.target.value, 10) || 0 })
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="dropLast" className="text-sm">
              {t("splitNode.dropLast")}
            </Label>
            <Input
              type="number"
              min="0"
              value={nodeTypeSettings.dropLast}
              onChange={(e) =>
                onNodeTypeSettingsChange({ ...nodeTypeSettings, dropLast: parseInt(e.target.value, 10) || 0 })
              }
            />
          </div>
          {!nodeTypeSettings.autoUpdate && (
            <Button onClick={onRegenerate} className="w-full">
              {t("common.update")}
            </Button>
          )}
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
