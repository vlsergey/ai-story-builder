import { trpc } from "@/ipcClient"
import { useTranslation } from "react-i18next"
import { zodResolver } from "@hookform/resolvers/zod"
import { type AiEngineDefinition, BUILTIN_ENGINES } from "@shared/ai-engines"
import { type AiGenerationSettings, getAiGenerationSettingsSchema } from "@shared/ai-generation-settings"
import { type ReactNode, useCallback, useEffect, useId, useState } from "react"
import { useForm } from "react-hook-form"
import AiGenerationSettingsFieldGroup from "./AiGenerationSettingsFieldGroup"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../ui-components/accordion"
import { Switch } from "../ui-components/switch"
import { Label } from "../ui-components/label"
import { Field } from "../ui-components/field"
import { useDebouncedCallback } from "use-debounce"

export default function AiGenerationSettingsFormWrapper(
  props: Omit<AiGenerationSettingsFormProps, "aiEngineDef" | "defaultAiGenerationSettings">,
) {
  const { t } = useTranslation()
  const currentAiEngine = trpc.settings.allAiEnginesConfig.currentEngine.get.useQuery()?.data
  const currentAiEngineDef = BUILTIN_ENGINES.find((it) => it.id === currentAiEngine)
  const defaultAiGenerationSettings =
    trpc.settings.allAiEnginesConfig.currentEngine.defaultAiGenerationSettings.get.useQuery()?.data || {}

  if (!currentAiEngineDef) {
    return <span>{t("aiGenerationSettings.noEngine")}</span>
  }

  return (
    <AiGenerationSettingsForm
      {...props}
      aiEngineDef={currentAiEngineDef}
      defaultAiGenerationSettings={defaultAiGenerationSettings}
    />
  )
}

interface AiGenerationSettingsFormProps {
  className?: string
  aiEngineDef: AiEngineDefinition
  defaultAiGenerationSettings: AiGenerationSettings
  value?: Partial<AiGenerationSettings> | null | undefined
  onChange: (aiGenerationSettings: AiGenerationSettings | null) => void
}

function AiGenerationSettingsForm({
  aiEngineDef,
  className,
  defaultAiGenerationSettings,
  value,
  onChange,
}: AiGenerationSettingsFormProps): ReactNode {
  const { t } = useTranslation()
  const [overriden, setOverriden] = useState<boolean>(!value)

  useEffect(() => {
    setOverriden(value != null)
  }, [value])

  const formSchema = getAiGenerationSettingsSchema(aiEngineDef)

  const { handleSubmit, control, watch } = useForm<AiGenerationSettings>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      ...defaultAiGenerationSettings,
      ...value,
    },
  })

  const changeOverriden = useCallback(
    (e: boolean) => {
      setOverriden(e)
      if (e) {
        handleSubmit((data) => onChange(data))()
      } else {
        onChange(null)
      }
    },
    [handleSubmit, onChange],
  )

  const debouncedSubmit = useDebouncedCallback(() => {
    handleSubmit(onChange)()
  }, 1000)

  useEffect(() => {
    const subscription = watch(debouncedSubmit)
    return () => subscription.unsubscribe()
  }, [watch, debouncedSubmit])

  const switchId = useId()

  return (
    <Accordion asChild={true} collapsible value={overriden ? "override" : ""} type="single">
      <div className={className}>
        <AccordionItem value="override">
          <AccordionTrigger>
            <Field orientation="horizontal">
              <Switch id={switchId} onCheckedChange={changeOverriden} checked={overriden} />
              <Label htmlFor={switchId}>{t("aiGenerationSettings.override")}</Label>
            </Field>
          </AccordionTrigger>
          <AccordionContent>
            <form onSubmit={handleSubmit(onChange)}>
              <AiGenerationSettingsFieldGroup engineId={aiEngineDef.id} formControl={control} />
            </form>
          </AccordionContent>
        </AccordionItem>
      </div>
    </Accordion>
  )
}
