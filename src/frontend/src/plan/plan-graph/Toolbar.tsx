import { useTranslation } from "react-i18next"
import { ButtonGroup } from "@/ui-components/button-group"
import { Button } from "@/ui-components/button"
import CreateNodeButtonGroup from "./CreateNodeButtonGroup"

interface ToolbarProps {
  className?: string
  compact?: boolean
  autoLayout: boolean
  toggleAutoLayout: () => void
  applyLayout: () => void
}

export default function Toolbar({
  className,
  compact = false,
  autoLayout,
  toggleAutoLayout,
  applyLayout,
}: ToolbarProps) {
  const { t } = useTranslation()
  return (
    <ButtonGroup className={className}>
      <CreateNodeButtonGroup />
      {!compact && (
        <ButtonGroup>
          <label className="flex items-center gap-1 text-xs cursor-pointer">
            <input type="checkbox" checked={autoLayout} onChange={toggleAutoLayout} className="w-3 h-3" />
            {t("planGraph.toolbar.autoLayout")}
          </label>
          {!autoLayout && (
            <Button variant="ghost" onClick={applyLayout}>
              {t("planGraph.toolbar.applyLayout")}
            </Button>
          )}
        </ButtonGroup>
      )}
    </ButtonGroup>
  )
}
