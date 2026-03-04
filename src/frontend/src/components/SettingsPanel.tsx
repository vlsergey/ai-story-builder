import React, { useEffect, useState } from 'react'
import {
  BUILTIN_ENGINES,
  CAPABILITY_KEYS,
  AGE_RATING_INFO,
  AGE_RATING_ORDER,
  type AiEngineDefinition,
} from '../lib/ai-engines'
import { dispatchAiEngineChanged } from '../lib/lore-events'
import { useLocale } from '../lib/locale'

interface ConfigData {
  current_engine: string | null
  grok: { api_key: string }
  yandex: { api_key: string; folder_id: string }
}

interface TestState {
  loading: boolean
  result?: { ok: boolean; detail?: string; error?: string }
}

export default function SettingsPanel() {
  const { t } = useLocale()
  const [config, setConfig] = useState<ConfigData | null>(null)
  const [loading, setLoading] = useState(true)
  const [currentEngine, setCurrentEngine] = useState<string | null>(null)
  const [engineError, setEngineError] = useState<string | null>(null)
  const [testStates, setTestStates] = useState<Record<string, TestState>>({})
  const [showField, setShowField] = useState<Record<string, boolean>>({})
  const [textLanguage, setTextLanguage] = useState('ru-RU')

  // form values: engineId → fieldKey → value
  const [formValues, setFormValues] = useState<Record<string, Record<string, string>>>({})

  useEffect(() => {
    Promise.all([
      fetch('/api/ai/config').then(r => r.json()) as Promise<ConfigData>,
      fetch('/api/settings/text_language').then(r => r.json()) as Promise<{ value: string | null }>,
    ]).then(([aiData, langData]) => {
        setConfig(aiData)
        setCurrentEngine(aiData.current_engine)
        if (langData.value) setTextLanguage(langData.value)
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
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  async function handleTextLanguageChange(lang: string) {
    setTextLanguage(lang)
    await fetch('/api/settings/text_language', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: lang }),
    })
  }

  async function handleEngineSelect(engine: string | null) {
    setEngineError(null)
    const res = await fetch('/api/ai/current-engine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine }),
    })
    const data = await res.json() as { ok?: boolean; error?: string }
    if (!res.ok) {
      setEngineError(data.error ?? 'Failed to save')
      return
    }
    setCurrentEngine(engine)
    dispatchAiEngineChanged()
  }

  async function saveField(engineId: string, fieldKey: string, value: string) {
    await fetch('/api/ai/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine: engineId, fields: { [fieldKey]: value } }),
    })
  }

  async function handleTest(engine: AiEngineDefinition) {
    setTestStates(prev => ({ ...prev, [engine.id]: { loading: true } }))
    const fields = formValues[engine.id] ?? {}
    try {
      const res = await fetch(`/api/ai/${engine.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      })
      const result = await res.json() as { ok: boolean; detail?: string; error?: string }
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
                        className={`text-[10px] font-bold px-1 py-0.5 rounded ${info.colorClass}`}
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

        {/* Spacer at bottom */}
        <div className="h-4" />
      </div>
    </div>
  )
}
