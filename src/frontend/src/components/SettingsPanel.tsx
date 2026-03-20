import React, { useEffect, useState } from 'react'
import { BUILTIN_ENGINES, AiEngineKey } from '../lib/ai-engines'
import { ipcClient } from '../ipcClient'
import { dispatchAiEngineChanged } from '../lib/lore-events'
import { useLocale } from '../lib/locale'
import { useTheme } from '../lib/theme/theme-provider'
import { AiConfigStore, AiEngineConfig } from '@shared/ai-engine-config'
import AiEngineConfigEditor from './AiEngineConfigEditor'

export default function SettingsPanel() {
  const { t, locale, setLocale } = useLocale()
  const { preference: themePreference, setPreference: setThemePreference } = useTheme()
  const [loading, setLoading] = useState(true)
  const [aiConfigStore, setAiConfigStore] = useState<AiConfigStore | null>(null)
  const [currentBackend, setCurrentBackend] = useState<string | null>(null)
  const [engineError, setEngineError] = useState<string | null>(null)
  const [textLanguage, setTextLanguage] = useState('ru-RU')
  const [verboseAiLogging, setVerboseAiLogging] = useState(false)
  const [autoGenerateSummary, setAutoGenerateSummary] = useState(false)

  useEffect(() => {
    Promise.all([
      ipcClient.ai.getAiConfigStore(),
      ipcClient.settings.get('current_backend'),
      ipcClient.settings.get('text_language'),
      ipcClient.settings.get('verbose_ai_logging'),
      ipcClient.settings.get('auto_generate_summary'),
    ]).then(([loadedAiConfigStore, loadedCurrentBackend, langData, verboseData, summaryData]) => {
        setAiConfigStore(loadedAiConfigStore)
        setCurrentBackend(loadedCurrentBackend.value)
        if (langData.value) setTextLanguage(langData.value)
        setVerboseAiLogging(verboseData.value === 'true')
        setAutoGenerateSummary(summaryData.value === 'true')
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
      await ipcClient.ai.setCurrentEngine(engine)
      setCurrentBackend(engine)
      dispatchAiEngineChanged()
    } catch (e) {
      setEngineError((e as Error).message ?? 'Failed to save')
    }
  }

  async function handleAiEngineConfigChange(engineId: AiEngineKey, aiEngineConfig: AiEngineConfig) {
    setAiConfigStore(prev => ({...prev, [engineId]: aiEngineConfig}))
    await ipcClient.ai.saveAiEngineConfig(engineId, aiEngineConfig)
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
              value={currentBackend ?? ''}
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
        {BUILTIN_ENGINES.map(engine => 
          <AiEngineConfigEditor
            key={engine.id}
            engine={engine}
            active={currentBackend === engine.id}
            value={aiConfigStore?.[engine.id] ?? {}}
            onChange={(value: AiConfigStore) => handleAiEngineConfigChange(engine.id, value)}
            />
        )}

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
