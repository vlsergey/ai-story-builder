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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui-components/select"
import { Textarea } from "@/ui-components/textarea"
import { zodResolver } from "@hookform/resolvers/zod"
import { AGE_RATING_INFO, AGE_RATING_ORDER } from "@shared/ai-engines"
import type { WizardField, WizardPage } from "@shared/project-template"
import { buildFormSchema } from "@shared/project-template-form"
import type { SettingsTypes } from "@shared/settings"
import { useCallback, useId, useMemo, type ReactElement, type SetStateAction } from "react"
import { useTranslation } from "react-i18next"
import {
  Controller,
  useForm,
  useWatch,
  type ControllerFieldState,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form"
import AdviceField from "./AdviceField"

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
  /** AI engine + config the user picked on earlier wizard pages. Forwarded to
   *  any `advice`-type fields so they can call the LLM without a project DB. */
  settings: Partial<SettingsTypes> | undefined
}

export default function TemplateSettingsWizardPage<T extends string, R extends Record<T, any>>({
  formId,
  onChange,
  onNext,
  values,
  wizardPage,
  settings,
}: TemplateSettingsWizardPageProps<T, R>) {
  const formSchema = buildFormSchema(wizardPage.fields)

  // Seed missing form values from each field's defaultValue (if declared).
  // Fields without a defaultValue in the template stay undefined; fields the
  // user already filled on a prior visit keep their entered value.
  const seededValues = { ...(values as Record<string, any>) }
  for (const f of wizardPage.fields) {
    if (seededValues[f.name] === undefined && "defaultValue" in f && f.defaultValue !== undefined) {
      seededValues[f.name] = f.defaultValue
    }
  }

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: seededValues as any,
  })

  const afterSubmit = useCallback(
    (data: any) => {
      onChange((oldValue) => ({ ...oldValue, ...data }))
      onNext()
    },
    [onChange, onNext],
  )

  // Combine the values from previous pages (`values`) with this page's current
  // form state so advice prompts can reference fields filled earlier (e.g.
  // synopsis on page 1, chunksCount + advice on page 2).
  const liveFields = useWatch({ control: form.control })
  const adviceContext = useMemo(() => {
    const merged: Record<string, string> = {}
    for (const [k, v] of Object.entries(values as Record<string, unknown>)) {
      if (v != null) merged[k] = String(v)
    }
    for (const [k, v] of Object.entries(liveFields)) {
      if (v != null) merged[k] = String(v)
    }
    return merged
  }, [values, liveFields])

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
                <ControllableWizardFieldRenderer<R>
                  wizardField={wizardField}
                  field={field}
                  fieldState={fieldState}
                  settings={settings}
                  adviceContext={adviceContext}
                />
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
  settings: Partial<SettingsTypes> | undefined
  adviceContext: Record<string, string>
}

function ControllableWizardFieldRenderer<T extends FieldValues>({
  field,
  fieldState,
  wizardField,
  settings,
  adviceContext,
}: ControllableWizardFieldRendererProps<T>): ReactElement {
  const htmlId = useId()
  const { t } = useTranslation("ai-engines")
  return (
    <Field data-invalid={fieldState.invalid}>
      <FieldContent>
        <FieldLabel htmlFor={htmlId}>{wizardField.label}</FieldLabel>
        <FieldDescription>{wizardField.description}</FieldDescription>
      </FieldContent>
      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
      {wizardField.type === "input" && (
        <Input
          className="w-full"
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
          className="w-full max-h-64 overflow-y-auto"
          id={htmlId}
          name={field.name}
          placeholder={wizardField.placeholder}
          value={field.value}
          onChange={field.onChange}
          onBlur={field.onBlur}
        />
      )}
      {wizardField.type === "integer" && (
        <Input
          className="w-24"
          id={htmlId}
          name={field.name}
          type="number"
          min={wizardField.min}
          max={wizardField.max}
          step={1}
          value={field.value ?? wizardField.defaultValue ?? wizardField.min}
          onChange={(e) => field.onChange(Number(e.target.value))}
          onBlur={field.onBlur}
        />
      )}
      {wizardField.type === "advice" && (
        <AdviceField
          wizardField={wizardField}
          htmlId={htmlId}
          engineId={settings?.currentBackend ?? null}
          aiEngineConfig={
            settings?.currentBackend ? settings?.allAiEnginesConfig?.[settings.currentBackend] : undefined
          }
          wizardData={adviceContext}
        />
      )}
      {wizardField.type === "select-age-rating" && (
        <Select value={field.value ?? ""} onValueChange={field.onChange}>
          <SelectTrigger id={htmlId} className="w-full" onBlur={field.onBlur}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AGE_RATING_ORDER.map((rating) => {
              const info = AGE_RATING_INFO[rating]
              return (
                <SelectItem key={rating} value={info.label}>
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: info.bg, color: info.fg }}
                    >
                      {info.label}
                    </span>
                    <span>{t(`ageRating.${rating}.longLabel`)}</span>
                  </span>
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      )}
    </Field>
  )
}
