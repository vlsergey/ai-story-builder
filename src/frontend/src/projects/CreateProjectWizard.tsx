import { trpc } from "@/ipcClient"
import { Button } from "@/ui-components/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui-components/dialog"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/ui-components/field"
import { Input } from "@/ui-components/input"
import { Separator } from "@/ui-components/separator"
import { Tabs, TabsList, TabsTrigger } from "@/ui-components/tabs"
import { Textarea } from "@/ui-components/textarea"
import { zodResolver } from "@hookform/resolvers/zod"
import { WizardField } from "@shared/project-template"
import { buildFormSchema } from "@shared/project-template-form"
import { defineStepper, Get, Step } from "@stepperize/react"
import { ReactElement, useId, useMemo } from "react"
import {
  Controller,
  ControllerFieldState,
  ControllerRenderProps,
  DefaultValues,
  FieldPath,
  FieldValues,
  useForm
} from "react-hook-form"
import { useTranslation } from "react-i18next"
import z, { ZodType } from "zod"

interface CreateProjectWizardProps {
  templatePath?: string
}

type StepImpl = Step & {
  title: string
}

export default function CreateProjectWizard<T extends FieldValues>({
  templatePath = "/home/vlsergey/github/ai-story-builder/dist/backend/resources/templates/simple-single-arc.ru.json",
}: CreateProjectWizardProps) {
  const { t } = useTranslation("projects")

  const projectTemplate = trpc.project.getTemplate.useQuery(templatePath).data

  const formSchema = useMemo(
    () => (projectTemplate === undefined ? z.object<T>() : buildFormSchema(projectTemplate)) as ZodType<T>,
    [projectTemplate],
  )

  const form = useForm<T>({
    resolver: zodResolver(formSchema as any),
    defaultValues: {} as DefaultValues<T>,
  })

  const { useStepper } = useMemo(() => {
    const wizardPages = projectTemplate?.wizardPages || []
    const wizardSteps: StepImpl[] = wizardPages.map((page) => ({ id: `wizard-page-${page.id}`, title: page.title }))
    const allSteps: StepImpl[] = [...wizardSteps, { id: "confirm", title: "Confirm" }, { id: "done", title: "Done" }]

    return defineStepper(...allSteps)
  }, [projectTemplate])
  const stepper = useStepper()

  const flowSwitch: Get.Switch<StepImpl[], React.ReactElement> = useMemo(() => {
    const result: Get.Switch<StepImpl[], React.ReactElement> = {}

    for (const wizardPage of projectTemplate?.wizardPages || []) {
      result[`wizard-page-${wizardPage.id}`] = () => (
        <FieldGroup>
          <FieldSet>
            {wizardPage.description && <FieldDescription>{wizardPage.description}</FieldDescription>}
            {wizardPage.fields.map((wizardField) => (
              <Controller
                key={wizardField.name}
                name={wizardField.name as any}
                control={form.control}
                render={({field, fieldState}) => (
                  <ControllableFieldRenderer
                    wizardField={wizardField}
                    field={field}
                    fieldState={fieldState}
                  />
                )}
              />
            ))}
          </FieldSet>
        </FieldGroup>
      )
    }

    result.confirm = () => <p>Confirm.</p>
    result.done = () => <p>Confirm.</p>
    return result
  }, [form.control, projectTemplate?.wizardPages])

  return (
    <Dialog open>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("CreateProjectWizard.title")}</DialogTitle>
        </DialogHeader>
        <Separator className="w-full" />
        <div className="flex gap-5 items-begin w-full">
          <Tabs className="shrink-0" value={stepper.state.current.data.id} orientation="vertical">
            <TabsList variant="line">
              {stepper.state.all.map((step) => (
              <TabsTrigger key={step.id} value={step.id}>
                {step.title}
              </TabsTrigger>
            ))}
            </TabsList>
          </Tabs>
          <div className="flex-1 min-h-64">{stepper.flow.switch(flowSwitch)}</div>
        </div>
        <Separator className="w-full" />
        <div className="flex justify-end w-full">
          {!stepper.state.isFirst && (
            <Button type="button" onClick={() => stepper.navigation.prev()}>
              Back
            </Button>
          )}
          {stepper.state.isLast ? (
            <Button type="button" onClick={() => stepper.navigation.reset()}>
              Reset
            </Button>
          ) : (
            <Button type="button" onClick={() => stepper.navigation.next()}>
              Next
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface ControllableFieldRendererProps<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> {
  field: ControllerRenderProps<TFieldValues, TName>
  fieldState: ControllerFieldState
  wizardField: WizardField
}

function ControllableFieldRenderer<T extends FieldValues>({ field, fieldState, wizardField }: ControllableFieldRendererProps<T>): ReactElement {
  const htmlId = useId()
  return (
    <Field data-invalid={fieldState.invalid}>
      <FieldContent key="content">
        <FieldLabel htmlFor={htmlId}>{wizardField.label}</FieldLabel>
      </FieldContent>
      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
      {wizardField.type === "input" && (
        <Input
          className="w-28"
          id={htmlId}
          name={field.name}
          placeholder={wizardField.placeholder}
          value={field.value}
          onChange={field.onChange}
          onBlur={field.onBlur}
        />
      )}
      {wizardField.type === "textarea" && (
        <Textarea
          className="w-28"
          id={htmlId}
          name={field.name}
          placeholder={wizardField.placeholder}
          value={field.value}
          onChange={field.onChange}
          onBlur={field.onBlur}
        />
      )}
    </Field>
  )
}
