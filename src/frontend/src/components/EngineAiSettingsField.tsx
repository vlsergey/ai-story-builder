import { useLocale } from "@/lib/locale"
import { AiEngineDefinition, AiEngineField, AiEngineKey } from "@shared/ai-engines"
import { useState, useEffect } from "react"
import { Input } from "./ui/input"
import { Switch } from "./ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select"

interface EngineAiSettingsFieldProps<T> {
    disabled: boolean | undefined,
    engine: AiEngineDefinition,
    field: AiEngineField,
    value: T,
    onChange: (engine: AiEngineKey, fieldKey: string, value: T) => void,
}

export default function EngineAiSettingsField<T>( { disabled, engine, field, value, onChange } : EngineAiSettingsFieldProps<T>) {
    const { t } = useLocale()
    const [formValue, setFormValue] = useState<T>(value)

    // Sync local state when external value changes
    useEffect(() => {
        setFormValue(value)
    }, [value])

    const fieldLabel = t(`engine.${engine.id}.field.${field.key}.label`)

    const handleChange = (newValue: T) => {
        setFormValue(newValue)
        onChange(engine.id, field.key, newValue)
    }

    const handleBlur = () => {
        onChange(engine.id, field.key, formValue)
    }

    switch (field.type) {
        case 'number':
            return (
                <label className="flex items-center gap-1.5 text-sm shrink-0">
                    <span className="text-muted-foreground">{fieldLabel}</span>
                    <Input
                        type="number"
                        min={0}
                        value={formValue as number}
                        onChange={(e) => setFormValue(Number(e.target.value) as T)}
                        onBlur={handleBlur}
                        disabled={disabled}
                        className="w-28 h-8"
                    />
                </label>
            )
        case 'checkbox':
            return (
                <label className="flex items-center gap-1.5 text-sm shrink-0">
                    <Switch
                        checked={formValue as boolean}
                        onCheckedChange={(checked) => handleChange(checked as T)}
                        disabled={disabled}
                    />
                    <span className="text-muted-foreground">{fieldLabel}</span>
                </label>
            )
        case 'select':
            return (
                <label className="flex items-center gap-1.5 text-sm shrink-0">
                    <span className="text-muted-foreground">{fieldLabel}</span>
                    <Select
                        value={formValue as string}
                        onValueChange={(val) => handleChange(val as T)}
                        disabled={disabled}
                    >
                        <SelectTrigger className="w-28 h-8">
                            <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                            {field.options?.map(option => (
                                <SelectItem key={option} value={option}>
                                    {t(`engine.${engine.id}.field.${field.key}.option.${option}`, option)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </label>
            )
        case 'password':
            return (
                <label className="flex items-center gap-1.5 text-sm shrink-0">
                    <span className="text-muted-foreground">{fieldLabel}</span>
                    <Input
                        type="password"
                        value={formValue as string}
                        onChange={(e) => setFormValue(e.target.value as T)}
                        onBlur={handleBlur}
                        disabled={disabled}
                        className="w-28 h-8"
                    />
                </label>
            )
        case 'input':
            return (
                <label className="flex items-center gap-1.5 text-sm shrink-0">
                    <span className="text-muted-foreground">{fieldLabel}</span>
                    <Input
                        type="text"
                        value={formValue as string}
                        onChange={(e) => setFormValue(e.target.value as T)}
                        onBlur={handleBlur}
                        disabled={disabled}
                        className="w-28 h-8"
                    />
                </label>
            )
        case 'textarea':
            return (
                <label className="flex flex-col gap-1.5 text-sm">
                    <span className="text-muted-foreground">{fieldLabel}</span>
                    <textarea
                        value={formValue as string}
                        onChange={(e) => setFormValue(e.target.value as T)}
                        onBlur={handleBlur}
                        disabled={disabled}
                        className="text-sm border border-border rounded px-2 py-0.5 bg-background disabled:opacity-50 resize-y min-h-[60px]"
                    />
                </label>
            )
        default:
            return null
    }
}