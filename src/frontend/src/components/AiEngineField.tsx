import { ReactNode, useState } from 'react'
import { useLocale } from "@/lib/locale"
import { AiEngineDefinition, AiEngineFieldDef } from "@shared/ai-engines"
import { ComponentProps, useId } from "react"
import { Input } from "./ui/input"
import { Switch } from "./ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select"
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "./ui/field"
import { Control, Controller, FieldValues } from "react-hook-form"
import { TriangleAlert, Info, Eye, EyeOff } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip"
import { ButtonGroup } from './ui/button-group'
import { Button } from './ui/button'

interface AiEngineFieldProps {
    className?: string,
    disabled?: boolean,
    formControl: Control<FieldValues>,
    formFieldNamePrefix?: string,
    engine: AiEngineDefinition,
    field: AiEngineFieldDef,
    orientation: ComponentProps<typeof Field>['orientation'],
}

export default function AiEngineField({ className, disabled, formControl, formFieldNamePrefix = "", engine, field, orientation } : AiEngineFieldProps) {
    const { t } = useLocale()
    const htmlId = useId();
    const fieldLabel = t(`engine.${engine.id}.field.${field.key}.label`)
    const fieldHint = t(`engine.${engine.id}.field.${field.key}.hint`, null)

    const [showHiddenValue, setShowHiddenValue] = useState<boolean>(false)

    const zChecks = field.schema?.def.checks ?? [];

    const zCheckLessThan = zChecks.find(c => c._zod.def.check === "less_than") as (any | undefined)
    const max = zCheckLessThan?._zod?.def?.value
    const maxIncuded = zCheckLessThan?._zod?.def?.inclusive as boolean | undefined;

    const zCheckGreaterThan = zChecks.find(c => c._zod.def.check === "greater_than") as (any | undefined)
    const min = zCheckGreaterThan?._zod?.def?.value
    const minIncuded = zCheckGreaterThan?._zod?.def?.inclusive as boolean | undefined;

    const fieldRender: ComponentProps<typeof Controller>['render'] = ({ field: { name, value, onChange, onBlur }, fieldState: {invalid} }) => {
        switch (field.type) {
            case 'decimal':
                return (<Input
                    aria-invalid={invalid}
                    type="number"
                    step="any"
                    name={name}
                    id={htmlId}
                    min={zCheckGreaterThan ? min : undefined}
                    max={zCheckLessThan ? max : undefined}
                    value={value ?? ''}
                    onChange={onChange}
                    onBlur={onBlur}
                    disabled={disabled}
                    className="w-28"
                />)
            case 'integer':
                return (<Input
                    aria-invalid={invalid}
                    id={htmlId}
                    name={name}
                    type="number"
                    min={zCheckGreaterThan ? (minIncuded ? min : min + 1) : undefined}
                    max={zCheckLessThan ? (maxIncuded ? max : max - 1) : undefined}
                    value={value ?? ''}
                    onChange={onChange}
                    onBlur={onBlur}
                    disabled={disabled}
                    className="w-28"
                />)
            case 'checkbox':
                return (<Switch
                    aria-invalid={invalid}
                    checked={value ?? ''}
                    name={name}
                    id={htmlId}
                    onCheckedChange={onChange}
                    onBlur={onBlur}
                />)
            case 'select':
                return (<Select
                    aria-invalid={invalid}
                    name={name}
                    value={value ?? ''}
                    onValueChange={onChange}
                    disabled={disabled}
                >
                    <SelectTrigger id={htmlId}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {field.options?.map(option => (
                            <SelectItem key={option} value={option}>
                                {t(`engine.${engine.id}.field.${field.key}.option.${option}`, option)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>)
            case 'input':
                return (<Input
                    className="w-28"
                    id={htmlId}
                    name={name}
                    value={value ?? ''}
                    onChange={onChange}
                    onBlur={onBlur}
                    aria-invalid={invalid} />)
            case 'password':
                return (<ButtonGroup>
                    <Input
                        autoCorrect='false'
                        autoCapitalize='none'
                        autoComplete='off'
                        className="w-28"
                        id={htmlId}
                        name={name}
                        type={showHiddenValue ? 'text' : 'password'}
                        value={value ?? ''}
                        onChange={onChange}
                        onBlur={onBlur}
                        aria-invalid={invalid} />
                    <Button variant="secondary" onClick={() => setShowHiddenValue(v => !v)}>
                      { showHiddenValue ? <EyeOff /> : <Eye /> }
                    </Button>
                </ButtonGroup>)
            default:
                return <span key={field.key}/>
        }
    }

    switch (orientation) {
        case 'horizontal':
            return (<Controller
                    control={formControl}
                    name={(formFieldNamePrefix + field.key) as any}
                    render={({ field, fieldState, fieldState: {error, invalid}, formState }) => (
                    <Field orientation={orientation} className={className} data-invalid={invalid}>
                        <FieldContent key="content">
                            <FieldLabel htmlFor={htmlId} className="whitespace-nowrap">{fieldLabel}</FieldLabel>
                        </FieldContent>
                        {invalid && <FieldErrorTooltip><FieldError errors={[error]} /></FieldErrorTooltip>}
                        {fieldHint && !invalid && <FieldHintTooltip key="hint">{fieldHint}</FieldHintTooltip>}
                        {fieldRender({field, fieldState, formState})}
                    </Field>)} />)
        default:
            return (<Controller
                    control={formControl}
                    name={(formFieldNamePrefix + field.key) as any}
                    render={({ field, fieldState, fieldState: {error, invalid}, formState }) => (
                    <Field orientation={orientation} className={className} data-invalid={invalid}>
                        <FieldContent key="content">
                            <FieldLabel htmlFor={htmlId}>{fieldLabel}</FieldLabel>
                        </FieldContent>
                        {fieldRender({field, fieldState, formState})}
                        {fieldHint && <FieldDescription key="hint">{fieldHint}</FieldDescription>}
                        {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                    </Field>)} />)
    }
}

function FieldHintTooltip({ children }: { children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="h-4 w-4 text-muted-foreground cursor-help hover:text-primary transition-colors" />
      </TooltipTrigger>
      <TooltipContent side="top" align="center">
        {children}
      </TooltipContent>
    </Tooltip>
  )
}

function FieldErrorTooltip({ children }: { children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <TriangleAlert className="h-4 w-4 text-muted-foreground cursor-help hover:text-error transition-colors" />
      </TooltipTrigger>
      <TooltipContent side="top" align="center">
        {children}
      </TooltipContent>
    </Tooltip>
  )
}