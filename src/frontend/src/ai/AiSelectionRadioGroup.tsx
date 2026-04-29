import { FieldContent, FieldDescription, FieldLabel } from "@/ui-components/field"
import { RadioGroup, RadioGroupItem } from "@/ui-components/radio-group"
import { AI_ENGINES_KEYS, type AiEngineKey } from "@shared/ai-engines"
import { useId } from "react"
import { useTranslation } from "react-i18next"

interface BaseAiSelectionRadioGroupProps<T extends AiEngineKey | null> {
  nullAllowed: boolean
  value: T
  onChange: (value: T) => void
}

interface NullAllowed extends BaseAiSelectionRadioGroupProps<AiEngineKey | null> {
  nullAllowed: true
}
interface NullNotAllowed extends BaseAiSelectionRadioGroupProps<AiEngineKey> {
  nullAllowed: false
}

type AiSelectionRadioGroupProps = NullAllowed | NullNotAllowed

export default function AiSelectionRadioGroup({ nullAllowed, value, onChange }: AiSelectionRadioGroupProps) {
  const { t } = useTranslation("ai-engines")

  const htmlIdForNull = useId()
  // biome-ignore lint/correctness/useHookAtTopLevel: let's count it as top level
  const htmlIdForEngines = Object.fromEntries(AI_ENGINES_KEYS.map((key) => [key, useId()]))

  return (
    <RadioGroup
      value={value === null ? "null" : value}
      onValueChange={(e) => (e === "null" ? onChange(null as any) : onChange(e as AiEngineKey))}
    >
      {nullAllowed && (
        <div className="flex items-begin gap-3">
          <RadioGroupItem value="null" id={htmlIdForNull} />
          <FieldContent>
            <FieldLabel htmlFor={htmlIdForNull}>{t("engine.null.name")}</FieldLabel>
            <FieldDescription>{t("engine.null.description")}</FieldDescription>
          </FieldContent>
        </div>
      )}
      {AI_ENGINES_KEYS.map((aiEngineKey) => (
        <div key={aiEngineKey} className="flex items-begin gap-3">
          <RadioGroupItem value={aiEngineKey} id={htmlIdForEngines[aiEngineKey]} />
          <FieldContent>
            <FieldLabel htmlFor={htmlIdForEngines[aiEngineKey]}>{t(`engine.${aiEngineKey}.name`)}</FieldLabel>
            <FieldDescription>{t(`engine.${aiEngineKey}.description`)}</FieldDescription>
          </FieldContent>
        </div>
      ))}
    </RadioGroup>
  )
}
