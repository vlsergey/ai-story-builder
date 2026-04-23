import { useCallback, useId, useState } from "react"
import { type AiEngineKey, BUILTIN_ENGINES } from "../lib/ai-engines"
import { useLocale } from "../i18n/locale"
import { useTranslation } from "react-i18next"
import { useTheme } from "../lib/theme/theme-provider"
import AiEngineConfigEditor from "../ai/AiEngineConfigEditor"
import { trpc } from "../ipcClient"
import type { AiEngineConfig } from "@shared/ai-engine-config"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui-components/select"
import { Field, FieldLabel, FieldDescription, FieldGroup, FieldError, FieldContent } from "../ui-components/field"
import SettingSwitch from "./SettingSwitch"

function useSetAndInvalidate<T extends { useMutation: any }>(procedure: T) {
  const utils = trpc.useUtils()

  // Достаем путь процедуры (в tRPC v10/11 он лежит в _def.path)
  const path = (procedure as any)._def().path
  const parentPath = path.slice(0, -1)

  return procedure.useMutation({
    onSettled: () => {
      // Идем по тому же пути внутри utils и вызываем invalidate
      let current: any = utils
      parentPath.forEach((part: string) => {
        current = current[part]
      })
      // Если это был .set, пробуем инвалидировать .get в той же папке
      // Либо просто инвалидируем всю ветку (родителя)
      current.invalidate()
    },
  })
}

export default function SettingsPanel() {
  const { locale, setLocale } = useLocale()
  const { t } = useTranslation(["ai-engines", "settings"])
  const { themePreference, setThemePreference } = useTheme()

  const { data: aiConfigStore, isLoading: isAiConfigStoreLoading } = trpc.settings.allAiEnginesConfig.get.useQuery()
  const { data: currentEngine, isLoading: isCurrentEngineLoading } =
    trpc.settings.allAiEnginesConfig.currentEngine.get.useQuery()
  const [engineError, setEngineError] = useState<string | null>(null)
  const utils = trpc.useUtils()

  const setCurrentEngine = trpc.settings.allAiEnginesConfig.currentEngine.set.useMutation({
    onSuccess: () => setEngineError(null),
    onError: (error: any) => setEngineError(error.message),
    onSettled: () => utils.settings.allAiEnginesConfig.currentEngine.invalidate(),
  }).mutate

  const setAllAiEnginesConfig = useSetAndInvalidate(trpc.settings.allAiEnginesConfig.set).mutate

  const setAiEngineConfig = useCallback(
    (engineId: string, aiEngineConfig: AiEngineConfig) => {
      const currentConfig = aiConfigStore ?? {}
      setAllAiEnginesConfig({
        ...currentConfig,
        [engineId]: aiEngineConfig,
      })
    },
    [aiConfigStore, setAllAiEnginesConfig],
  )

  const htmlIdLanguage = useId()
  const htmlIdTheme = useId()
  const htmlIdCurrentEngine = useId()

  if (isAiConfigStoreLoading) {
    return (
      <div className="flex items-center justify-center">
        <span className="text-muted-foreground text-sm">{t("settings:loading")}</span>
      </div>
    )
  }

  return (
    <div className="p-2 h-full overflow-auto">
      <FieldGroup className="p-2">
        {/* ── Interface Language ── */}
        <Field orientation="responsive">
          <FieldContent>
            <FieldLabel htmlFor={htmlIdLanguage}>{t("settings:uiLanguage.title")}</FieldLabel>
          </FieldContent>
          <Select value={locale} onValueChange={setLocale}>
            <SelectTrigger id={htmlIdLanguage}>
              <SelectValue placeholder={t("settings:uiLanguage.select")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">{t("settings:uiLanguage.en")}</SelectItem>
              <SelectItem value="ru">{t("settings:uiLanguage.ru")}</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        {/* ── Theme ── */}
        <Field orientation="responsive">
          <FieldContent>
            <FieldLabel htmlFor={htmlIdTheme}>{t("settings:theme.title")}</FieldLabel>
          </FieldContent>
          <Select value={themePreference} onValueChange={setThemePreference}>
            <SelectTrigger id={htmlIdTheme}>
              <SelectValue placeholder={t("settings:theme.select")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{t("settings:theme.auto")}</SelectItem>
              <SelectItem value="obsidian">{t("settings:theme.obsidian")}</SelectItem>
              <SelectItem value="github">{t("settings:theme.github")}</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <SettingSwitch settingKey="autoGenerateSummary" />

        {/* ── Current AI Engine ── */}
        <Field orientation="responsive">
          <FieldContent>
            <FieldLabel htmlFor={htmlIdCurrentEngine}>{t("settings:aiEngine.title")}</FieldLabel>
            <FieldDescription>{t("settings:aiEngine.description")}</FieldDescription>
          </FieldContent>
          <Select
            disabled={isCurrentEngineLoading}
            value={currentEngine ?? "none"}
            onValueChange={(value) => setCurrentEngine(value === "none" ? null : (value as AiEngineKey))}
          >
            <SelectTrigger id={htmlIdCurrentEngine} className="w-64">
              <SelectValue placeholder={t("settings:aiEngine.select")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("settings:aiEngine.none")}</SelectItem>
              {BUILTIN_ENGINES.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {t(`ai-engines:engine.${e.id}.name`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {engineError && <FieldError>{engineError}</FieldError>}
        </Field>

        <SettingSwitch settingKey="verboseAiLogging" />
      </FieldGroup>

      {/* ── Per-engine sections ── */}
      {BUILTIN_ENGINES.map((engine) => (
        <AiEngineConfigEditor
          key={engine.id}
          engine={engine}
          active={currentEngine === engine.id}
          value={aiConfigStore?.[engine.id] ?? {}}
          onChange={(value) => setAiEngineConfig(engine.id, value)}
        />
      ))}

      {/* Spacer at bottom */}
      <div className="h-4" />
    </div>
  )
}
