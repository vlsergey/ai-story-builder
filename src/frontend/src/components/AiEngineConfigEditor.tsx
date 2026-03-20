import { useLocale } from "@/lib/locale";
import { AiEngineConfig } from "@shared/ai-engine-config";
import { AGE_RATING_INFO, AGE_RATING_ORDER, AiEngineDefinition, CAPABILITY_KEYS } from "@shared/ai-engines";
import { useCallback, useState } from "react";
import { Button } from "./ui/button";
import { ipcClient } from "@/ipcClient";
import AiGenerationSettings from "./AiGenerationSettings";
import { AiGenerationSettings as AiGenerationSettingsDto } from "@shared/ai-generation-settings";

interface AiEngineConfigEditorProps<T extends AiEngineConfig = AiEngineConfig> {
    active: boolean,
    engine: AiEngineDefinition,
    value: T,
    onChange: (value: T) => void,
}

interface TestState {
  loading: boolean
  result?: { ok: boolean; detail?: string; error?: string }
}

export default function AiEngineConfigEditor<T extends AiEngineConfig = AiEngineConfig>({active, engine, value, onChange}: AiEngineConfigEditorProps<T>) {
    const { t } = useLocale()
    const [testState, setTestState] = useState<TestState>({ loading: false })
    const [isRefreshingModels, setRefreshingModels] = useState<boolean>(false)
    const [showField, setShowField] = useState<Record<string, boolean>>({})
    const [formValues, setFormValues] = useState<Record<string, string>>({})

    const maxRatingIdx = AGE_RATING_ORDER.indexOf(engine.ageRating)
    const supportedRatings = AGE_RATING_ORDER.slice(0, maxRatingIdx + 1)

    const engineModels: string[] = value.available_models ?? []
    const engineNotes = t(`engine.${engine.id}.notes`, '')

    const onFieldChange = useCallback((fieldKey: string, fieldValue: any) => {
        onChange({...value, [fieldKey]: fieldValue})
    }, [value, onChange])

    const onRefreshingModels = useCallback(async () => {
        setRefreshingModels(true)
        try {
            const data = await ipcClient.ai.refreshModels(engine.id)
            if (data.models) {
                onChange({ ...value, available_models: data.models })
            }
        } finally {
            setRefreshingModels(false)
        }
    }, [engine, onChange, setRefreshingModels, value])

    const onDefaultAiGenerationSettingsChange = useCallback((defaultAiGenerationSettings: AiGenerationSettingsDto) => {
        onChange( {...value, defaultAiGenerationSettings} )
    }, [onChange, value])

    const onSummaryAiGenerationSettingsChange = useCallback((summaryAiGenerationSettings: AiGenerationSettingsDto) => {
        onChange( {...value, summaryAiGenerationSettings} )
    }, [onChange, value])

    const onTest = useCallback(async () => {
        setTestState({ loading: true })
        try {
            const result = await ipcClient.ai.test(engine.id, value)
            setTestState({ loading: false, result })
        } catch (e) {
            setTestState({ loading: false, result: { ok: false, error: String(e) } })
        }
    }, [engine, setTestState, value])

    return (
    <section
        key={engine.id}
        className={`border rounded-lg p-4 ${active ? 'border-primary' : 'border-border'}`}
    >
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
        <h3 className="text-sm font-semibold">{t(`engine.${engine.id}.name`)}</h3>
        <span className="text-xs text-muted-foreground">{t('settings.aiEngine.by')} {engine.provider}</span>
        {active && (
            <span className="text-xs text-primary font-medium">{t('settings.aiEngine.active')}</span>
        )}
        <div className="ml-auto flex gap-0.5">
            {supportedRatings.map(rating => {
            const info = AGE_RATING_INFO[rating]
            return (
                <span
                key={rating}
                className="text-[10px] font-bold px-1 py-0.5 rounded"
                style={{ backgroundColor: info.bg, color: info.fg }}
                title={t(`ageRating.${rating}.longLabel`)}
                >
                {info.label}
                </span>
            )
            })}
        </div>
        </div>

        {/* Credential fields */}
        <div className="flex flex-col gap-2 mb-3">
        {engine.configFields.map(field => {
            const value = formValues[field.key] ?? field.defaultValue ?? ''
            const fieldLabel = t(`engine.${engine.id}.field.${field.key}.label`)
            const fieldHint = t(`engine.${engine.id}.field.${field.key}.hint`, '')
            const shown = showField[field.key]
            const updateValue = (v: string) =>
            setFormValues(prev => ({ ...prev, [field.key]: v }))
            return (
            <div key={field.key} className="flex flex-col gap-0.5">
                <label className="text-xs text-muted-foreground">{fieldLabel}</label>
                {field.type === 'textarea' ? (
                <textarea
                    value={value}
                    rows={4}
                    onChange={e => updateValue(e.target.value)}
                    onBlur={e => onFieldChange(field.key, e.target.value)}
                    className="text-sm border border-border rounded px-2 py-1 bg-background font-mono resize-y"
                    placeholder={field.defaultValue ?? fieldLabel}
                    spellCheck={false}
                />
                ) : (
                <div className="flex gap-1">
                    <input
                    type={field.type === 'password' && !shown ? 'password' : 'text'}
                    value={value}
                    onChange={e => updateValue(e.target.value)}
                    onBlur={e => onFieldChange(field.key, e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') onFieldChange(field.key, value)
                    }}
                    className="flex-1 text-sm border border-border rounded px-2 py-1 bg-background"
                    placeholder={fieldLabel}
                    spellCheck={false}
                    autoComplete="off"
                    />
                    {field.type === 'password' && (
                    <Button
                        type="button"
                        onClick={() =>
                        setShowField(prev => ({ ...prev, [field.key]: !prev[field.key] }))
                        }
                        className="text-xs px-2 py-1 border border-border rounded hover:bg-muted shrink-0"
                    >
                        {shown ? 'Hide' : 'Show'}
                    </Button>
                    )}
                </div>
                )}
                {fieldHint && (
                    <p className="text-xs text-muted-foreground">{fieldHint}</p>
                )}
            </div>
            )
        })}
        </div>

        {/* Models */}
        <div className="flex items-start gap-2 mb-3">
        <span className="text-xs text-muted-foreground shrink-0 mt-0.5">
            {t('settings.models.title')}:
        </span>
        <span className="text-xs text-muted-foreground flex-1 leading-relaxed">
            {engineModels.length > 0
            ? engineModels.map(m => m.replace(/^gpt:\/\/[^/]+\//, '')).join(', ')
            : t('settings.models.none')}
        </span>
        <Button
            variant="outline"
            onClick={onRefreshingModels}
            disabled={isRefreshingModels}
        >
            {isRefreshingModels ? t('settings.models.refreshing') : t('settings.models.refresh')}
        </Button>
        </div>

        {/* Default generation settings */}
        <div className="mb-4">
        <p className="text-xs font-medium text-muted-foreground mb-1.5">
            {t('settings.defaultAiGenerationSettings.title')}
        </p>
        <AiGenerationSettings
            engineId={engine.id}
            value={value.defaultAiGenerationSettings ?? {}}
            onChange={onDefaultAiGenerationSettingsChange}
            disabled={!active}
        />
        </div>

        {/* Summary generation settings */}
        <div className="mb-4">
        <p className="text-xs font-medium text-muted-foreground mb-1.5">
            {t('settings.summaryAiGenerationSettings.title')}
        </p>
        <AiGenerationSettings
            engineId={engine.id}
            value={value.summaryAiGenerationSettings ?? {}}
            onChange={onSummaryAiGenerationSettingsChange}
            disabled={!active}
        />
        </div>

        {/* Test button + result */}
        <div className="flex items-center gap-2 mb-4">
        <Button
            variant="outline"
            onClick={onTest}
            disabled={testState?.loading}
        >
            {testState?.loading ? t('settings.testing') : t('settings.testConnection')}
        </Button>
        {testState?.result && (
            <span
            className={`text-xs ${testState.result.ok ? 'text-green-600' : 'text-destructive'}`}
            >
            {testState.result.ok
                ? `✓ ${testState.result.detail}`
                : `✗ ${testState.result.error}`}
            </span>
        )}
        </div>

        {/* Capabilities */}
        <div>
        <p className="text-xs font-medium text-muted-foreground mb-1.5">{t('settings.capabilities')}</p>
        <div className="flex flex-col gap-1.5">
            {CAPABILITY_KEYS.map(capKey => {
            const supported = engine.capabilities[capKey]
            return (
                <div key={capKey} className="flex items-start gap-2">
                <span
                    className={`text-sm leading-tight mt-0.5 ${
                    supported ? 'text-green-600' : 'text-muted-foreground/40'
                    }`}
                    aria-label={supported ? 'supported' : 'not supported'}
                >
                    {supported ? '✓' : '✗'}
                </span>
                <div>
                    <p
                    className={`text-xs font-medium leading-tight ${
                        supported ? '' : 'text-muted-foreground/60'
                    }`}
                    >
                    {t(`capability.${capKey}.label`)}
                    </p>
                    <p className="text-xs text-muted-foreground">{t(`capability.${capKey}.description`)}</p>
                </div>
                </div>
            )
            })}
        </div>
        </div>

        {/* Engine notes */}
        {engineNotes && (
        <p className="text-xs text-muted-foreground mt-3 italic">{engineNotes}</p>
        )}
    </section>
    )

}