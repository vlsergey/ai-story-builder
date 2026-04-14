import { useState, useEffect } from "react"
import type { PlanNodeRow } from "@shared/plan-graph"
import { useLocale } from "@/lib/locale"
import { Button } from "@/ui-components/button"
import { Input } from "@/ui-components/input"
import { Label } from "@/ui-components/label"
import { Textarea } from "@/ui-components/textarea"

interface ForEachNodeEditorProps {
  node: PlanNodeRow
  onUpdate: (data: Partial<PlanNodeRow>) => void
  panelApi?: { setTitle: (title: string) => void }
}

export default function ForEachNodeEditor({ node, onUpdate, panelApi }: ForEachNodeEditorProps) {
  const { t } = useLocale()
  const [iteration, setIteration] = useState(0)
  const [iterations, setIterations] = useState<string[]>([])

  useEffect(() => {
    if (panelApi) {
      panelApi.setTitle(node.title)
    }
  }, [panelApi, node.title])

  // Parse content as array of iterations
  useEffect(() => {
    if (node.content) {
      try {
        const parsed = JSON.parse(node.content)
        if (Array.isArray(parsed)) {
          setIterations(parsed.map((item) => (typeof item === "string" ? item : JSON.stringify(item))))
        } else {
          setIterations([])
        }
      } catch {
        setIterations([])
      }
    } else {
      setIterations([])
    }
  }, [node.content])

  const handleTitleChange = (title: string) => {
    onUpdate({ title })
  }

  const handleContentChange = (content: string) => {
    onUpdate({ content })
  }

  return (
    <div className="h-full overflow-auto p-4 space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-2">{t("plan.forEach.title")}</h3>
        <p className="text-sm text-muted-foreground">{t("plan.forEach.description")}</p>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="title">{t("plan.title")}</Label>
          <Input id="title" value={node.title} onChange={(e) => handleTitleChange(e.target.value)} className="mt-1" />
        </div>
      </div>

      <div className="border rounded p-4">
        <h4 className="font-medium mb-3">{t("plan.forEach.iterations")}</h4>
        <div className="flex items-center gap-4 mb-4">
          <div className="flex-1">
            <Label>{t("plan.forEach.selectIteration")}</Label>
            <div className="flex items-center gap-2 mt-1">
              <select
                className="border rounded px-3 py-1.5 text-sm flex-1"
                value={iteration}
                onChange={(e) => setIteration(Number(e.target.value))}
              >
                {iterations.map((_, idx) => (
                  <option key={idx} value={idx}>
                    {t("plan.forEach.iteration")} {idx + 1}
                  </option>
                ))}
                {iterations.length === 0 && <option value={0}>{t("plan.forEach.noIterations")}</option>}
              </select>
              <span className="text-sm text-muted-foreground whitespace-nowrap">
                {iterations.length} {t("plan.forEach.iterations")}
              </span>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => {}}>
            {t("plan.forEach.loadIteration")}
          </Button>
        </div>

        {iterations.length > 0 ? (
          <div>
            <Label>{t("plan.forEach.content")}</Label>
            <Textarea className="mt-1 font-mono text-sm" rows={10} value={iterations[iteration]} readOnly />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("plan.forEach.noData")}</p>
        )}
      </div>

      <div>
        <h4 className="font-medium mb-2">{t("plan.forEach.rawContent")}</h4>
        <Textarea
          className="font-mono text-sm"
          rows={6}
          value={node.content || ""}
          onChange={(e) => handleContentChange(e.target.value)}
          placeholder={t("plan.forEach.rawContentPlaceholder")}
        />
        <p className="text-xs text-muted-foreground mt-1">{t("plan.forEach.rawContentDescription")}</p>
      </div>
    </div>
  )
}
