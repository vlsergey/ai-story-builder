import AiEngineField from "@/ai/AiEngineField"
import { trpc } from "@/ipcClient"
import { Button } from "@/ui-components/button"
import { FieldGroup, FieldSet } from "@/ui-components/field"
import { Separator } from "@/ui-components/separator"
import { zodResolver } from "@hookform/resolvers/zod"
import { getAiEngineConfigSchema } from "@shared/ai-engine-config"
import { BUILTIN_ENGINES } from "@shared/ai-engines"
import type { SettingsTypes } from "@shared/settings"
import { type SetStateAction, useCallback } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import z from "zod"

interface AiSettingsWizardPageProps {
  formId: string
  onNext: () => void
  onSettingsChange: (settings: SetStateAction<Partial<SettingsTypes> | undefined>) => void
  settings: Partial<SettingsTypes> | undefined
}

export default function AiSettingsWizardPage({
  formId,
  onNext,
  onSettingsChange,
  settings,
}: AiSettingsWizardPageProps) {
  const engineId = settings?.currentBackend || null
  const engineDef = BUILTIN_ENGINES.find((engine) => engine.id === engineId)

  const formSchema = engineDef !== undefined ? getAiEngineConfigSchema(engineDef) : z.any()
  type FormData = z.infer<typeof formSchema>

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: engineId !== null ? settings?.allAiEnginesConfig?.[engineId] : {},
  })

  const afterSubmit = useCallback(
    (data: FormData) => {
      if (engineId === null) {
        onNext()
        return
      }

      onSettingsChange((oldSettings) => ({
        ...oldSettings,
        allAiEnginesConfig: {
          ...oldSettings?.allAiEnginesConfig,
          [engineId]: data,
        },
      }))
      onNext()
    },
    [engineId, onNext, onSettingsChange],
  )

  const testMutation = trpc.ai.test.useMutation()
  const { t } = useTranslation("ai-engines")

  if (engineDef === undefined) {
    return <form id={formId} onSubmit={form.handleSubmit(afterSubmit)} />
  }

  return (
    <form id={formId} onSubmit={form.handleSubmit(afterSubmit)}>
      <FieldSet>
        <FieldGroup>
          {engineDef.configFields.map((field) => (
            <AiEngineField
              engine={engineDef}
              field={field}
              formControl={form.control}
              key={field.key}
              orientation="vertical"
            />
          ))}
        </FieldGroup>
      </FieldSet>
      <Separator className="w-full" />
      <div className="flex items-center gap-2 mb-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => testMutation.mutate({ engineId: engineDef.id, aiEngineConfig: form.getValues() })}
          disabled={testMutation.isPending}
        >
          {testMutation.isPending ? t("settings.testing") : t("settings.testConnection")}
        </Button>
        {(testMutation.isError || testMutation.isSuccess) && (
          <span
            className={`text-xs ${testMutation.isSuccess && testMutation.data.ok ? "text-green-600" : "text-destructive"}`}
          >
            {testMutation.isSuccess && testMutation.data.ok
              ? `✓ ${testMutation.data.detail}`
              : `✗ ${testMutation.data?.detail || testMutation.error?.message || "unknown error"}`}
          </span>
        )}
      </div>
    </form>
  )
}
