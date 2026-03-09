import React, { useEffect, useState } from 'react'
import {
  BUILTIN_ENGINES,
  CAPABILITY_KEYS,
  AGE_RATING_INFO,
  AGE_RATING_ORDER,
  type AiEngineDefinition,
} from '../lib/ai-engines'
import { ipcClient } from '../ipcClient'
import { dispatchAiEngineChanged } from '../lib/lore-events'
import { useLocale } from '../lib/locale'
import { useTheme } from '../lib/theme/theme-provider'
import AiGenerationSettings from './AiGenerationSettings'
import type { AiSettings } from '@shared/ai-settings'

interface ConfigData {
  current_engine: string | null
  grok: { api_key: string; available_models: string[] }
  yandex: { api_key: string; folder_id: string; available_models: string[] }
}

interface TestState {
  loading: boolean
  result?: { ok: boolean; detail?: string; error?: string }
}

export default function SettingsPanel() {
  const { t, locale, setLocale } = useLocale()
  const { preference: themePreference, setPreference: setThemePreference } = useTheme()
  const [config, setConfig] = useState<ConfigData | null>(null)
  const [loading, setLoading] = useState(true)
  const [currentEngine, setCurrentEngine] = useState<string | null>(null)
  const [engineError, setEngineError] = useState<string | null>(null)
  const [testStates, setTestStates] = useState<Record<string, TestState>>({})
  const [refreshingModels, setRefreshingModels] = useState<Record<string, boolean>>({})
  const [showField, setShowField] = useState<Record<string, boolean>>({})
  const [textLanguage, setTextLanguage] = useState('ru-RU')
  const [verboseAiLogging, setVerboseAiLogging] = useState(false)
  const [autoGenerateSummary, setAutoGenerateSummary] = useState(false)

  // form values: engineId → fieldKey → value
  const [formValues, setFormValues] = useState<Record<string, Record<string, string>>>({})
  // summary settings per engine
  const [summarySettings, setSummarySettings] = useState<Record<string, AiSettings>>({})

  useEffect(() => {
    Promise.all([
      ipcClient.ai.getConfig() as unknown as Promise<ConfigData>,
      ipcClient.settings.get('text_language'),
      ipcClient.settings.get('verbose_ai_logging'),
      ipcClient.settings.get('auto_generate_summary'),
    ]).then(([aiData, langData, verboseData, summaryData]) => {
        setConfig(aiData)
        setCurrentEngine(aiData.current_engine)
        if (langData.value) setTextLanguage(langData.value)
        setVerboseAiLogging(verboseData.value === 'true')
        setAutoGenerateSummary(summaryData.value === 'true')
        // Use saved values, falling back to field defaultValue if nothing stored yet
        const initialValues: Record<string, Record<string, string>> = {}
        for (const engine of BUILTIN_ENGINES) {
          const saved = (aiData as unknown as Record<string, Record<string, string>>)[engine.id] ?? {}
          initialValues[engine.id] = {}
          for (const field of engine.configFields) {
            const stored = saved[field.key] ?? ''
            initialValues[engine.id][field.key] = stored !== '' ? stored : (field.defaultValue ?? '')
          }
        }
        setFormValues(initialValues)

        // Initialize summary settings
        const initialSummarySettings: Record<string, AiSettings> = {}
        for (const engine of BUILTIN_ENGINES) {
          const saved = (aiData as unknown as Record<string, Record<string, unknown>>)[engine.id] ?? {}
          const savedSummary = saved.summary_settings as AiSettings | undefined
          initialSummarySettings[engine.id] = savedSummary ?? {
            model: '',
            includeExistingLore: false,
            webSearch: 'none',
            maxTokens: 2048,
            maxCompletionTokens: undefined,
          }
        }
        setSummarySettings(initialSummarySettings)

        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  async function handleVerboseAiLoggingChange(enabled: boolean) {
    setVerboseAiLogging(enabled)
    await ipcClient.settings.setVerboseAiLogging(String(enabled))
  }

  async function handleAutoGenerateSummaryChange(enabled: boolean) {
    setAutoGenerateSummary(enabled)
    await ipcClient.settings.set('auto_generate_summary', String(enabled))
  }

  async function handleTextLanguageChange(lang: string) {
    setTextLanguage(lang)
    await ipcClient.settings.set('text_language', lang)
  }

  async function handleEngineSelect(engine: string | null) {
    setEngineError(null)
    try {
      await ipcClient.ai.setCurrentEngine({ engine })
      setCurrentEngine(engine)
      dispatchAiEngineChanged()
    } catch (e) {
      setEngineError((e as Error).message ?? 'Failed to save')
    }
  }

  async function saveField(engineId: string, fieldKey: string, value: string) {
    await ipcClient.ai.saveConfig({ engine: engineId, fields: { [fieldKey]: value } })
  }

  async function handleRefreshModels(engineId: string) {
    setRefreshingModels(prev => ({ ...prev, [engineId]: true }))
    try {
      const data = await ipcClient.ai.refreshModels(engineId)
      if (data.models) {
        setConfig(prev => {
          if (!prev) return prev
          return {
            ...prev,
            [engineId]: { ...(prev[engineId as keyof ConfigData] as object), available_models: data.models! },
          } as ConfigData
        })
      }
    } finally {
      setRefreshingModels(prev => ({ ...prev, [engineId]: false }))
    }
  }

  async function handleSummarySettingsChange(engineId: string, settings: AiSettings) {
    setSummarySettings(prev => ({ ...prev, [engineId]: settings }))
    await ipcClient.ai.saveConfig({ engine: engineId, fields: { summary_settings: settings as unknown as Record<string, unknown> } })
  }

  async function handleTest(engine: AiEngineDefinition) {
    setTestStates(prev => ({ ...prev, [engine.id]: { loading: true } }))
    const fields = formValues[engine.id] ?? {}
    try {
      const result = await ipcClient.ai.test(engine.id, fields)
      setTestStates(prev => ({ ...prev, [engine.id]: { loading: false, result } }))
    } catch (e) {
      setTestStates(prev => ({
        ...prev,
        [engine.id]: { loading: false, result: { ok: false, error: String(e) } },
      }))
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-muted-foreground text-sm">{t('settings.loading')}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="flex flex-col gap-6 p-4">

        {/* ── Interface Language ── */}
        <section>
          <h2 className="text-base font-semibold mb-3">{t('settings.uiLanguage.title')}</h2>
          <select
            value={locale}
            onChange={e => setLocale(e.target.value)}
            className="border border-border rounded px-2 py-1.5 text-sm bg-background w-64"
          >
            <option value="en">{t('settings.uiLanguage.en')}</option>
            <option value="ru">{t('settings.uiLanguage.ru')}</option>
          </select>
        </section>

        {/* ── Theme ── */}
        <section>
          <h2 className="text-base font-semibold mb-3">{t('settings.theme.title')}</h2>
          <select
            value={themePreference}
            onChange={e => setThemePreference(e.target.value)}
            className="border border-border rounded px-2 py-1.5 text-sm bg-background w-64"
          >
            <option value="auto">{t('settings.theme.auto')}</option>
            <option value="obsidian">{t('settings.theme.obsidian')}</option>
            <option value="github">{t('settings.theme.github')}</option>
          </select>
        </section>

        {/* ── Text Language ── */}
        <section>
          <h2 className="text-base font-semibold mb-3">{t('settings.textLanguage.title')}</h2>
          <div className="flex flex-col gap-1.5">
            <select
              value={textLanguage}
              onChange={e => handleTextLanguageChange(e.target.value)}
              className="border border-border rounded px-2 py-1.5 text-sm bg-background w-64"
            >
              <option value="ru-RU">Русский (ru-RU)</option>
              <option value="en-US">English (en-US)</option>
            </select>
            <p className="text-xs text-muted-foreground max-w-md">
              {t('settings.textLanguage.description')}
            </p>
          </div>
        </section>

        {/* ── Auto-summary generation ── */}
        <section>
          <h2 className="text-base font-semibold mb-3">{t('settings.autoSummary.title')}</h2>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoGenerateSummary}
              onChange={e => handleAutoGenerateSummaryChange(e.target.checked)}
              className="mt-0.5 shrink-0"
            />
            <div>
              <p className="text-sm">{t('settings.autoSummary.title')}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t('settings.autoSummary.description')}
              </p>
            </div>
          </label>
        </section>

        {/* ── Current AI Engine ── */}
        <section>
          <h2 className="text-base font-semibold mb-3">{t('settings.aiEngine.title')}</h2>
          <div className="flex flex-col gap-1.5">
            <select
              value={currentEngine ?? ''}
              onChange={e => handleEngineSelect(e.target.value || null)}
              className="border border-border rounded px-2 py-1.5 text-sm bg-background w-64"
            >
              <option value="">{t('settings.aiEngine.none')}</option>
              {BUILTIN_ENGINES.map(e => (
                <option key={e.id} value={e.id}>{t(`engine.${e.id}.name`)}</option>
              ))}
            </select>
            {engineError && (
              <span className="text-destructive text-xs">{engineError}</span>
            )}
            <p className="text-xs text-muted-foreground max-w-md">
              {t('settings.aiEngine.description')}
            </p>
          </div>
        </section>

        {/* ── Per-engine sections ── */}
        {BUILTIN_ENGINES.map(engine => {
          const maxRatingIdx = AGE_RATING_ORDER.indexOf(engine.ageRating)
          const supportedRatings = AGE_RATING_ORDER.slice(0, maxRatingIdx + 1)
          const testState = testStates[engine.id]
          const isActive = currentEngine === engine.id
          const engineModels: string[] = (config?.[engine.id as keyof ConfigData] as { available_models?: string[] })?.available_models ?? []
          const isRefreshing = refreshingModels[engine.id] ?? false
          const engineNotes = t(`engine.${engine.id}.notes`, '')

          return (
            <section
              key={engine.id}
              className={`border rounded-lg p-4 ${isActive ? 'border-primary' : 'border-border'}`}
            >
              {/* Header */}
              <div className="flex items-center gap-2 mb-4">
                <h3 className="text-sm font-semibold">{t(`engine.${engine.id}.name`)}</h3>
                <span className="text-xs text-muted-foreground">{t('settings.aiEngine.by')} {engine.provider}</span>
                {isActive && (
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
                  const fieldKey = `${engine.id}_${field.key}`
                  const shown = showField[fieldKey]
                  const value = formValues[engine.id]?.[field.key] ?? field.defaultValue ?? ''
                  const fieldLabel = t(`engine.${engine.id}.field.${field.key}.label`)
                  const fieldHint = t(`engine.${engine.id}.field.${field.key}.hint`, '')
                  const updateValue = (v: string) =>
                    setFormValues(prev => ({
                      ...prev,
                      [engine.id]: { ...(prev[engine.id] ?? {}), [field.key]: v },
                    }))
                  return (
                    <div key={field.key} className="flex flex-col gap-0.5">
                      <label className="text-xs text-muted-foreground">{fieldLabel}</label>
                      {field.type === 'textarea' ? (
                        <textarea
                          value={value}
                          rows={4}
                          onChange={e => updateValue(e.target.value)}
                          onBlur={e => saveField(engine.id, field.key, e.target.value)}
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
                            onBlur={e => saveField(engine.id, field.key, e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') saveField(engine.id, field.key, value)
                            }}
                            className="flex-1 text-sm border border-border rounded px-2 py-1 bg-background"
                            placeholder={fieldLabel}
                            spellCheck={false}
                            autoComplete="off"
                          />
                          {field.type === 'password' && (
                            <button
                              type="button"
                              onClick={() =>
                                setShowField(prev => ({ ...prev, [fieldKey]: !prev[fieldKey] }))
                              }
                              className="text-xs px-2 py-1 border border-border rounded hover:bg-muted shrink-0"
                            >
                              {shown ? 'Hide' : 'Show'}
                            </button>
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
                <button
                  type="button"
                  onClick={() => void handleRefreshModels(engine.id)}
                  disabled={isRefreshing}
                  className="text-xs px-2 py-0.5 border border-border rounded hover:bg-muted disabled:opacity-50 shrink-0"
                >
                  {isRefreshing ? t('settings.models.refreshing') : t('settings.models.refresh')}
                </button>
              </div>

              {/* Summary generation settings */}
              <div className="mb-4">
                <p className="text-xs font-medium text-muted-foreground mb-1.5">
                  {t('settings.summaryGeneration.title')}
                </p>
                <AiGenerationSettings
                  engineId={engine.id}
                  availableModels={engineModels}
                  settings={summarySettings[engine.id] ?? {}}
                  onSettingsChange={(s) => handleSummarySettingsChange(engine.id, s)}
                  disabled={!isActive}
                />
              </div>

              {/* Test button + result */}
              <div className="flex items-center gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => handleTest(engine)}
                  disabled={testState?.loading}
                  className="text-xs px-3 py-1 border border-border rounded hover:bg-muted disabled:opacity-50"
                >
                  {testState?.loading ? t('settings.testing') : t('settings.testConnection')}
                </button>
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
        })}

        {/* ── Debug ── */}
        <section>
          <h2 className="text-base font-semibold mb-3">{t('settings.debug.title')}</h2>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={verboseAiLogging}
              onChange={e => handleVerboseAiLoggingChange(e.target.checked)}
              className="mt-0.5 shrink-0"
            />
            <div>
              <p className="text-sm">{t('settings.debug.verboseAiLogging')}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t('settings.debug.verboseAiLoggingDescription')}
              </p>
            </div>
          </label>
        </section>

        {/* Spacer at bottom */}
        <div className="h-4" />
      </div>
    </div>
  )
}
