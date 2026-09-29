import { Card, CardContent, CardHeader, CardTitle } from "@/ui-components/card"
import { Input } from "@/ui-components/input"
import type { ParallelSettings } from "@shared/node-settings"
import { useTranslation } from "react-i18next"
import type TypedPlanNodeEditorProps from "./TypedPlanNodeEditorProps"

/**
 * A parallel loop's settings: how many of its iterations run at once. Empty
 * leaves it to the engine's own limit, set in the engine's settings.
 */
export default function ParallelNodeEditor({
  disabled,
  nodeTypeSettings,
  onNodeTypeSettingsChange,
}: TypedPlanNodeEditorProps<ParallelSettings>) {
  const { t } = useTranslation()

  return (
    <div className="space-y-6 p-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("parallelNode.settings")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">{t("parallelNode.concurrencyHint")}</p>
          <Input
            type="number"
            min={1}
            step={1}
            disabled={disabled}
            value={nodeTypeSettings.concurrency ?? ""}
            placeholder={t("parallelNode.concurrencyPlaceholder")}
            onChange={(e) => {
              const concurrency = Number.parseInt(e.currentTarget.value, 10)
              const { concurrency: _, ...rest } = nodeTypeSettings
              onNodeTypeSettingsChange(
                Number.isInteger(concurrency) && concurrency >= 1 ? { ...rest, concurrency } : rest,
              )
            }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
