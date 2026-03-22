import React, { useCallback, useState } from 'react'
import { BUILTIN_ENGINES } from '../lib/ai-engines'
import { useLocale } from '../lib/locale'
import { useTheme } from '../lib/theme/theme-provider'
import AiEngineConfigEditor from './AiEngineConfigEditor'
import { trpc } from '../ipcClient';
import { AiEngineConfig } from '@shared/ai-engine-config'
import { Switch } from './ui/switch'

function setAndInvalidate<T extends { useMutation: any }>(procedure: T) {
  const utils = trpc.useUtils();
  
  // Достаем путь процедуры (в tRPC v10/11 он лежит в _def.path)
  const path = (procedure as any)._def().path; 
  const parentPath = path.slice(0, -1);

  return procedure.useMutation({
    onSettled: () => {
      // Идем по тому же пути внутри utils и вызываем invalidate
      let current: any = utils;
      parentPath.forEach((part: string) => {
        current = current[part];
      });
      // Если это был .set, пробуем инвалидировать .get в той же папке
      // Либо просто инвалидируем всю ветку (родителя)
      current.invalidate(); 
    }
  });
}

export default function SettingsPanel() {
  const { t, locale, setLocale } = useLocale()
  const { preference: themePreference, setPreference: setThemePreference } = useTheme()

  const {data: aiConfigStore, isLoading: isAiConfigStoreLoading} = trpc.settings.allAiEnginesConfig.get.useQuery()
  const {data: currentEngine, isLoading: isCurrentEngineLoading} = trpc.settings.allAiEnginesConfig.currentEngine.get.useQuery()
  const {data: autoGenerateSummary, isLoading: isAutoGenerateSummaryLoading} = trpc.settings.autoGenerateSummary.get.useQuery()
  const {data: textLanguage, isLoading: isTextLanguageLoading} = trpc.settings.textLanguage.get.useQuery()
  const {data: verboseAiLogging, isLoading: isVerboseAiLoggingLoading} = trpc.settings.verboseAiLogging.get.useQuery()
  const [engineError, setEngineError] = useState<string | null>(null)
  const utils = trpc.useUtils()

  const setCurrentEngine = trpc.settings.allAiEnginesConfig.currentEngine.set.useMutation({
    onSuccess: () => setEngineError(null),
    onError: (error: any) => setEngineError(error.message),
    onSettled: () => utils.settings.allAiEnginesConfig.currentEngine.invalidate(),
  }).mutate

  const setAllAiEnginesConfig = setAndInvalidate(trpc.settings.allAiEnginesConfig.set).mutate
  const setAutoGenerateSummary = setAndInvalidate(trpc.settings.autoGenerateSummary.set).mutate
  const setTextLanguage = setAndInvalidate(trpc.settings.textLanguage.set).mutate
  const setVerboseAiLogging = setAndInvalidate(trpc.settings.verboseAiLogging.set).mutate

  const setAiEngineConfig = useCallback((engineId: string, aiEngineConfig: AiEngineConfig) => {
    setAllAiEnginesConfig({
      ...aiConfigStore,
      [engineId]: aiEngineConfig,
    })
    utils.settings.allAiEnginesConfig.invalidate()
  }, [aiConfigStore, setAllAiEnginesConfig, utils.settings.allAiEnginesConfig])

  if (isAiConfigStoreLoading) {
    return (
      <div className="flex items-center justify-center">
        <span className="text-muted-foreground text-sm">{t('settings.loading')}</span>
      </div>
    )
  }

  return (
    <div className="gap-6 p-4 h-full overflow-auto">
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
            disabled={isTextLanguageLoading}
            value={textLanguage || ''}
            onChange={e => setTextLanguage(e.target.value)}
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
          <Switch
            disabled={isAutoGenerateSummaryLoading}
            checked={autoGenerateSummary}
            onCheckedChange={setAutoGenerateSummary}
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
            disabled={isCurrentEngineLoading}
            value={currentEngine ?? ''}
            onChange={e => setCurrentEngine(e.target.value || null)}
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
          active={currentEngine === engine.id}
          value={aiConfigStore?.[engine.id] ?? {}}
          onChange={(value) => setAiEngineConfig(engine.id, value)}
          />
      )}

      {/* ── Debug ── */}
      <section>
        <h2 className="text-base font-semibold mb-3">{t('settings.debug.title')}</h2>
        <label className="flex items-start gap-2 cursor-pointer">
          <Switch
            disabled={isVerboseAiLoggingLoading}
            checked={verboseAiLogging}
            onCheckedChange={setVerboseAiLogging}
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
  )
}
