import React, { useEffect, useState } from 'react'
import {
  BUILTIN_ENGINES,
  CAPABILITY_META,
  AGE_RATING_INFO,
  type AiEngineDefinition,
} from '../lib/ai-engines'
import { dispatchAiEngineChanged } from '../lib/lore-events'

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
          const saved = (aiData as Record<string, Record<string, string>>)[engine.id] ?? {}
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
        <span className="text-muted-foreground text-sm">Loading settings…</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="flex flex-col gap-6 p-4">

        {/* ── Text Language ── */}
        <section>
          <h2 className="text-base font-semibold mb-3">Text Language</h2>
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
              Language used in AI-generated story texts and lore items.
            </p>
          </div>
        </section>

        {/* ── Current AI Engine ── */}
        <section>
          <h2 className="text-base font-semibold mb-3">Current AI Engine</h2>
          <div className="flex flex-col gap-1.5">
            <select
              value={currentEngine ?? ''}
              onChange={e => handleEngineSelect(e.target.value || null)}
              className="border border-border rounded px-2 py-1.5 text-sm bg-background w-64"
            >
              <option value="">None</option>
              {BUILTIN_ENGINES.map(e => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
            {engineError && (
              <span className="text-destructive text-xs">{engineError}</span>
            )}
            <p className="text-xs text-muted-foreground max-w-md">
              Controls the sync-status icon in the Lore Tree.
              Required credentials must be saved before activating an engine.
            </p>
          </div>
        </section>

        {/* ── Per-engine sections ── */}
        {BUILTIN_ENGINES.map(engine => {
          const ageInfo = AGE_RATING_INFO[engine.ageRating]
          const testState = testStates[engine.id]
          const isActive = currentEngine === engine.id

          return (
            <section
              key={engine.id}
              className={`border rounded-lg p-4 ${isActive ? 'border-primary' : 'border-border'}`}
            >
              {/* Header */}
              <div className="flex items-center gap-2 mb-4">
                <h3 className="text-sm font-semibold">{engine.name}</h3>
                <span className="text-xs text-muted-foreground">by {engine.provider}</span>
                {isActive && (
                  <span className="text-xs text-primary font-medium">● active</span>
                )}
                <span
                  className={`ml-auto text-xs font-bold px-1.5 py-0.5 rounded ${ageInfo.colorClass}`}
                  title={ageInfo.longLabel}
                >
                  {ageInfo.label}
                </span>
              </div>

              {/* Credential fields */}
              <div className="flex flex-col gap-2 mb-3">
                {engine.configFields.map(field => {
                  const fieldKey = `${engine.id}_${field.key}`
                  const shown = showField[fieldKey]
                  const value = formValues[engine.id]?.[field.key] ?? field.defaultValue ?? ''
                  const updateValue = (v: string) =>
                    setFormValues(prev => ({
                      ...prev,
                      [engine.id]: { ...(prev[engine.id] ?? {}), [field.key]: v },
                    }))
                  return (
                    <div key={field.key} className="flex flex-col gap-0.5">
                      <label className="text-xs text-muted-foreground">{field.label}</label>
                      {field.type === 'textarea' ? (
                        <textarea
                          value={value}
                          rows={4}
                          onChange={e => updateValue(e.target.value)}
                          onBlur={e => saveField(engine.id, field.key, e.target.value)}
                          className="text-sm border border-border rounded px-2 py-1 bg-background font-mono resize-y"
                          placeholder={field.defaultValue ?? field.label}
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
                            placeholder={field.label}
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
                      {field.hint && (
                        <p className="text-xs text-muted-foreground">{field.hint}</p>
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
                  {testState?.loading ? 'Testing…' : 'Test Connection'}
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
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Capabilities</p>
                <div className="flex flex-col gap-1.5">
                  {CAPABILITY_META.map(cap => {
                    const supported = engine.capabilities[cap.key]
                    return (
                      <div key={cap.key} className="flex items-start gap-2">
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
                            {cap.label}
                          </p>
                          <p className="text-xs text-muted-foreground">{cap.description}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Engine notes */}
              {engine.notes && (
                <p className="text-xs text-muted-foreground mt-3 italic">{engine.notes}</p>
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
