import ControlledInputField from "@/forms/ControlledInputField"
import ControlledSwitch from "@/forms/ControlledSwitch"
import { trpc } from "@/ipcClient"
import { FieldGroup, FieldSet } from "@/ui-components/field"
import { zodResolver } from "@hookform/resolvers/zod"
import { useCallback, type SetStateAction } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import z from "zod"

interface ConfirmWizardPageProps {
  aiEngineSelected: boolean
  formId: string
  onGenerateChange: (title: SetStateAction<boolean>) => void
  onStartCreation: (title: string, generate: boolean) => Promise<void>
  onTitleChange: (title: SetStateAction<string>) => void
  generate: boolean
  title: string
}

export default function ConfirmWizardPage({
  aiEngineSelected,
  formId,
  generate,
  onGenerateChange,
  onStartCreation,
  onTitleChange,
  title,
}: ConfirmWizardPageProps) {
  const { t } = useTranslation("create-wizard")

  const hasProjectWithName = trpc.project.hasProjectWithName.useMutation().mutateAsync
  const formSchema = z.object({
    title: z
      .string()
      .min(1)
      .refine(async (value) => !value || !(await hasProjectWithName(value)), {
        message: t("title.alreadyExists"),
      }),
    generate: z.boolean(),
  })
  type FormValues = z.infer<typeof formSchema>

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: title ?? "",
      generate: generate ?? false,
    } as const,
    mode: "onChange",
  })

  const afterSubmit = useCallback(
    async (data: FormValues) => {
      onTitleChange(data.title)
      onGenerateChange(data.generate)
      await onStartCreation(data.title, data.generate)
    },
    [onGenerateChange, onStartCreation, onTitleChange],
  )

  return (
    <form id={formId} onSubmit={form.handleSubmit(afterSubmit)}>
      <FieldGroup>
        <FieldSet>
          <ControlledInputField
            formControl={form.control}
            name="title"
            label={t("title.label")}
            description={t("title.description")}
            orientation="vertical"
          />
          <ControlledSwitch
            orientation="vertical"
            disabled={!aiEngineSelected}
            description={t("generate.description")}
            formControl={form.control}
            label={t("generate.label")}
            name="generate"
          />
        </FieldSet>
      </FieldGroup>
    </form>
  )
}
