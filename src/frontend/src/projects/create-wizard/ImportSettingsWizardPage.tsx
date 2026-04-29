import ControllableFilePathField from "@/forms/ControllableFilePathField"
import { trpc } from "@/ipcClient"
import { zodResolver } from "@hookform/resolvers/zod"
import type { SettingsTypes } from "@shared/settings"
import { type SetStateAction, useCallback } from "react"
import { Controller, useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import z from "zod"

interface ImportSettingsWizardPageProps {
  onSettingsChange: (settings: SetStateAction<Partial<SettingsTypes> | undefined>) => void
  formId: string
  onNext: () => void
}

export default function ImportSettingsWizardPage({
  formId,
  onNext,
  onSettingsChange: setSettings,
}: ImportSettingsWizardPageProps) {
  const { t } = useTranslation("create-wizard")
  const projectsFolder = trpc.project.getProjectsFolder.useQuery().data

  const canRead = trpc.native.fs.canRead.useMutation().mutateAsync
  const formSchema = z.object({
    fileToImportSettingsFrom: z
      .string()
      .refine(async (value: null | string) => (value ? await canRead(value) : true), {
        message: t("fileToImportSettingsFrom.accessReadable"),
      })
      .optional(),
  })

  type FormValues = z.infer<typeof formSchema>

  const form = useForm({
    resolver: zodResolver(formSchema),
  })

  const getProjectSettings = trpc.project.getProjectSettings.useMutation().mutateAsync
  const afterSubmit = useCallback(
    async (data: FormValues) => {
      const fileToImportSettingsFrom = data.fileToImportSettingsFrom
      if (fileToImportSettingsFrom) {
        const projectSettings = await getProjectSettings(fileToImportSettingsFrom as string)
        setSettings(projectSettings)
      }
      onNext()
    },
    [onNext, setSettings],
  )

  return (
    <form id={formId} onSubmit={form.handleSubmit(afterSubmit)}>
      <Controller
        name={"fileToImportSettingsFrom"}
        control={form.control}
        render={({ field, fieldState }) => (
          <ControllableFilePathField
            label={t("fileToImportSettingsFrom.label")}
            description={t("fileToImportSettingsFrom.description")}
            defaultPath={projectsFolder}
            field={field}
            fieldState={fieldState}
            openDialogOptions={{
              filters: [
                { name: "Project files (SQLite)", extensions: ["sqlite"] },
                { name: "All files", extensions: ["*"] },
              ],
              properties: ["openFile", "dontAddToRecent"],
            }}
          />
        )}
      />
    </form>
  )
}
