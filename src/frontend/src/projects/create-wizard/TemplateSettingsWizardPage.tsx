import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/ui-components/field"
import { Input } from "@/ui-components/input"
import { Textarea } from "@/ui-components/textarea"
import { zodResolver } from "@hookform/resolvers/zod"
import type { WizardField, WizardPage } from "@shared/project-template"
import { buildFormSchema } from "@shared/project-template-form"
import { useCallback, useId, type ReactElement, type SetStateAction } from "react"
import {
  Controller,
  useForm,
  type ControllerFieldState,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form"

interface TemplateSettingsWizardPageProps<T extends string, R extends Record<T, any>> {
  formId: string
  onChange: (data: SetStateAction<R>) => void
  onNext: () => void
  values: R
  wizardPage: WizardPage & {
    fields: (WizardField & {
      name: T
    })[]
  }
}

export default function TemplateSettingsWizardPage<T extends string, R extends Record<T, any>>({
  formId,
  onChange,
  onNext,
  values,
  wizardPage,
}: TemplateSettingsWizardPageProps<T, R>) {
  const formSchema = buildFormSchema(wizardPage.fields)

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: values as any,
  })

  const afterSubmit = useCallback(
    (data: any) => {
      onChange((oldValue) => ({ ...oldValue, ...data }))
      onNext()
    },
    [onChange, onNext],
  )

  return (
    <form id={formId} onSubmit={form.handleSubmit(afterSubmit)}>
      <FieldGroup>
        <FieldSet>
          {wizardPage.fields.map((wizardField) => (
            <Controller
              key={wizardField.name}
              name={wizardField.name as any}
              control={form.control}
              render={({ field, fieldState }) => (
                <ControllableWizardFieldRenderer<R> wizardField={wizardField} field={field} fieldState={fieldState} />
              )}
            />
          ))}
        </FieldSet>
      </FieldGroup>
    </form>
  )
}

interface ControllableWizardFieldRendererProps<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> {
  field: ControllerRenderProps<TFieldValues, TName>
  fieldState: ControllerFieldState
  wizardField: WizardField
}

function ControllableWizardFieldRenderer<T extends FieldValues>({
  field,
  fieldState,
  wizardField,
}: ControllableWizardFieldRendererProps<T>): ReactElement {
  return (
    <ControllableFieldRenderer
      type={wizardField.type}
      label={wizardField.label}
      description={wizardField.description}
      placeholder={wizardField.placeholder}
      field={field}
      fieldState={fieldState}
    />
  )
}

interface ControllableFieldRendererProps<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> {
  type: "input" | "textarea"
  label: string
  description?: string
  placeholder?: string
  field: ControllerRenderProps<TFieldValues, TName>
  fieldState: ControllerFieldState
}

function ControllableFieldRenderer<T extends FieldValues>({
  type,
  field,
  fieldState,
  label,
  description,
  placeholder,
}: ControllableFieldRendererProps<T>): ReactElement {
  const htmlId = useId()
  return (
    <Field data-invalid={fieldState.invalid}>
      <FieldContent>
        <FieldLabel htmlFor={htmlId}>{label}</FieldLabel>
        <FieldDescription>{description}</FieldDescription>
      </FieldContent>
      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
      {type === "input" && (
        <Input
          className="w-28"
          id={htmlId}
          name={field.name}
          placeholder={placeholder}
          value={field.value}
          onChange={field.onChange}
          onBlur={field.onBlur}
        />
      )}
      {type === "textarea" && (
        <Textarea
          className="w-28"
          id={htmlId}
          name={field.name}
          placeholder={placeholder}
          value={field.value}
          onChange={field.onChange}
          onBlur={field.onBlur}
        />
      )}
    </Field>
  )
}
