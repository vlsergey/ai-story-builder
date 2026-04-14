import { useId } from "react"
import { BUILTIN_ENGINES } from "../../../shared/ai-engines"
import type { AiGenerationSettings as AiGenerationSettingsDto } from "../../../shared/ai-generation-settings"
import AiEngineField from "./AiEngineField"
import { trpc } from "@/ipcClient"
import type { AiEngineConfig } from "@shared/ai-engine-config"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../ui-components/select"
import { Field, FieldGroup, FieldLabel } from "../ui-components/field"
import { type Control, Controller } from "react-hook-form"

function shortModelName(modelId: string): string {
  return modelId.replace(/^gpt:\/\/[^/]+\//, "")
}

interface AiGenerationSettingsFieldGroupProps {
  className?: string
  formControl: Control<AiGenerationSettingsDto>
  formFieldNamePrefix?: string
  engineId: string | null
  disabled?: boolean
}

export default function AiGenerationSettingsFieldGroup({
  className = "flex-row flex-wrap",
  formControl,
  formFieldNamePrefix = "",
  engineId,
  disabled,
}: AiGenerationSettingsFieldGroupProps) {
  const engineDef = BUILTIN_ENGINES.find((e) => e.id === engineId)
  const allAiEnginesConfig = trpc.settings.allAiEnginesConfig.get.useQuery().data
  const aiEngineConfig: AiEngineConfig = engineId ? allAiEnginesConfig?.[engineId] || {} : {}
  const availableModels = aiEngineConfig.available_models || []

  const modelFieldId = useId()

  if (engineDef === undefined) return <span>Unknown engine {engineId}</span>
  return (
    <FieldGroup className={className}>
      <Controller
        name={`${formFieldNamePrefix}model`}
        control={formControl}
        render={({ field: { name, value, onChange } }) => (
          <Field orientation="horizontal" className="w-fit">
            <FieldLabel htmlFor={modelFieldId}>Model</FieldLabel>
            <Select name={name} disabled={disabled} value={value} onValueChange={onChange}>
              <SelectTrigger id={modelFieldId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {availableModels.map((m) => (
                    <SelectItem key={m} value={m}>
                      {shortModelName(m)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        )}
      />

      {engineDef?.aiSettingsFields.map((field) => (
        <AiEngineField
          className="w-fit !items-center"
          formControl={formControl}
          formFieldNamePrefix={formFieldNamePrefix}
          orientation="horizontal"
          key={field.key}
          disabled={disabled}
          engine={engineDef}
          field={field}
        />
      ))}
    </FieldGroup>
  )
}
