import { trpc } from "@/ipcClient"
import { Button } from "@/ui-components/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui-components/dialog"
import { Separator } from "@/ui-components/separator"
import { Tabs, TabsList, TabsTrigger } from "@/ui-components/tabs"
import type { WizardField, WizardPage } from "@shared/project-template"
import type { SettingsTypes } from "@shared/settings"
import { defineStepper, type Get, type Step } from "@stepperize/react"
import { type SetStateAction, useCallback, useId, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import AiSelectWizardPage from "./AiSelectWizardPage"
import ImportSettingsWizardPage from "./ImportSettingsWizardPage"
import TemplateSettingsWizardPage from "./TemplateSettingsWizardPage"
import AiSettingsWizardPage from "./AiSettingsWizardPage"
import ConfirmWizardPage from "./ConfirmWizardPage"
import { ButtonGroup } from "@/ui-components/button-group"

type StepImpl = Step & {
  title: string
}

interface CreateProjectWizardProps {
  onOpenChange: (data: SetStateAction<boolean>) => void
  open: boolean
  templateFilePath: string | null
}

export default function CreateProjectWizard({ open, onOpenChange, templateFilePath }: CreateProjectWizardProps) {
  const projectTemplate = trpc.project.getTemplate.useQuery(templateFilePath as string, {
    enabled: !!templateFilePath,
  }).data

  return (
    <CreateProjectWizardImpl
      open={open}
      onOpenChange={onOpenChange}
      templateFilePath={templateFilePath}
      wizardPages={projectTemplate?.wizardPages}
    />
  )
}

interface CreateProjectWizardPropsImpl<WizardFieldName extends string> {
  onOpenChange: (data: SetStateAction<boolean>) => void
  open: boolean
  templateFilePath: string | null
  wizardPages?: (WizardPage & {
    fields: (WizardField & {
      name: WizardFieldName
    })[]
  })[]
}

function CreateProjectWizardImpl<FieldNames extends string>({
  open,
  onOpenChange,
  templateFilePath,
  wizardPages,
}: CreateProjectWizardPropsImpl<FieldNames>) {
  const { t } = useTranslation("create-wizard")

  const baseFormId = useId()
  const [templateData, setTemplateData] = useState<Record<string, any>>({})
  const [settings, setSettings] = useState<Partial<SettingsTypes>>()
  const [title, setTitle] = useState<string>("")
  const [generate, setGenerate] = useState<boolean>(false)

  const createProject = trpc.project.create.useMutation().mutateAsync
  const applyProjectSettings = trpc.project.applyProjectSettings.useMutation().mutateAsync
  const regenerate = trpc.plan.nodes.aiGenerate.startForAll.useMutation().mutateAsync
  const handleCreate = useCallback(
    async (title: string, generate: boolean) => {
      try {
        await createProject({ templateFilePath: templateFilePath, templateData: templateData, title })
        if (settings) {
          await applyProjectSettings(settings)
        }
        onOpenChange(false)
        if (generate) {
          // start, do not wait
          regenerate()
        }
      } catch (e) {
        console.error(e)
      }
    },
    [onOpenChange, settings, templateData, templateFilePath],
  )

  const { useStepper } = useMemo(() => {
    const importSettingsStep: StepImpl = {
      id: "import-settings",
      title: t("import-settings.page-title"),
    }
    const aiSelectStep: StepImpl = { id: "ai-select", title: t("ai-select.page-title") }
    const aiSettingsStep: StepImpl = { id: "ai-settings", title: t("ai-settings.page-title") }

    const wizardSteps: StepImpl[] = (wizardPages || []).map((page) => ({
      id: `wizard-page-${page.id}`,
      title: page.title,
    }))
    const allSteps: StepImpl[] = [
      importSettingsStep,
      aiSelectStep,
      aiSettingsStep,
      ...wizardSteps,
      { id: "confirm", title: t("confirm.page-title") },
    ]

    return defineStepper(...allSteps)
  }, [wizardPages, t])
  const stepper = useStepper()

  const flowSwitch: Get.Switch<StepImpl[], React.ReactElement> = useMemo(() => {
    const result: Get.Switch<StepImpl[], React.ReactElement> = {}

    result["import-settings"] = () => (
      <ImportSettingsWizardPage
        formId={`${baseFormId}_import-settings`}
        onNext={stepper.navigation.next}
        onSettingsChange={setSettings}
      />
    )

    result["ai-select"] = () => (
      <AiSelectWizardPage
        formId={`${baseFormId}_ai-select`}
        onNext={stepper.navigation.next}
        settings={settings}
        onSettingsChange={setSettings}
      />
    )

    result["ai-settings"] = () => (
      <AiSettingsWizardPage
        formId={`${baseFormId}_ai-settings`}
        onNext={stepper.navigation.next}
        settings={settings}
        onSettingsChange={setSettings}
      />
    )

    for (const wizardPage of wizardPages || []) {
      result[`wizard-page-${wizardPage.id}`] = () => (
        <TemplateSettingsWizardPage
          wizardPage={wizardPage}
          formId={`${baseFormId}_wizard-page-${wizardPage.id}`}
          onNext={stepper.navigation.next}
          values={templateData}
          onChange={setTemplateData}
        />
      )
    }

    result.confirm = () => (
      <ConfirmWizardPage
        aiEngineSelected={!!settings?.currentBackend}
        formId={`${baseFormId}_confirm`}
        onGenerateChange={setGenerate}
        generate={generate}
        onStartCreation={handleCreate}
        onTitleChange={setTitle}
        title={title}
      />
    )
    return result
  }, [baseFormId, generate, settings, stepper.navigation.next, templateData, title, wizardPages, handleCreate])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col" showCloseButton>
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        <Separator className="w-full shrink-0" />
        <div className="flex gap-5 items-begin w-full flex-1 min-h-0">
          <Tabs className="shrink-0" value={stepper.state.current.data.id} orientation="vertical" aria-readonly>
            <TabsList variant="line">
              {stepper.state.all.map((step) => (
                <TabsTrigger key={step.id} value={step.id}>
                  {step.title}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="flex-1 min-h-64 overflow-y-auto pr-2">{stepper.flow.switch(flowSwitch)}</div>
        </div>
        <Separator className="w-full shrink-0" />
        <ButtonGroup className="flex justify-between w-full shrink-0">
          <ButtonGroup>
            <Button type="button" onClick={() => onOpenChange(false)}>
              {t("navigation.cancel")}
            </Button>
          </ButtonGroup>
          <ButtonGroup>
            {!stepper.state.isFirst && (
              <Button type="button" disabled={stepper.state.isTransitioning} onClick={() => stepper.navigation.prev()}>
                {t("navigation.back")}
              </Button>
            )}
            <Button
              type="submit"
              disabled={stepper.state.isTransitioning}
              form={`${baseFormId}_${stepper.state.current.data.id}`}
            >
              {stepper.state.isLast ? t("navigation.create") : t("navigation.next")}
            </Button>
          </ButtonGroup>
        </ButtonGroup>
      </DialogContent>
    </Dialog>
  )
}
