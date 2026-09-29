import { TabsTrigger } from "@/ui-components/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui-components/tooltip"
import { CircleQuestionMarkIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

/**
 * The tab of a node's system or user instructions to the model, with a hint
 * on hover. The tab is the button; the hint's trigger is a span inside it,
 * since a button inside a button is invalid HTML.
 */
export default function InstructionsTabTrigger({ kind }: { kind: "system" | "user" }) {
  const { t } = useTranslation()
  return (
    <TabsTrigger value={kind}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center gap-1">
            {t(`ai.${kind}Instructions`)}
            <CircleQuestionMarkIcon />
          </span>
        </TooltipTrigger>
        <TooltipContent>{t(`ai.${kind}Instructions.description`)}</TooltipContent>
      </Tooltip>
    </TabsTrigger>
  )
}
