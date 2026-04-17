import type React from "react"
import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react"
import {
  type ThemePreference,
  type ResolvedTheme,
  type ColorMode,
  DEFAULT_THEME_BY_MODE,
  THEME_TO_MODE,
  COLOR_MODES_VALUES,
} from "../../../../shared/themes.js"
import { trpc } from "@/ipcClient"
import { useSystemColorMode } from "./useSystemColorMode.js"

interface ThemeContextValue {
  themePreference: ThemePreference
  resolvedTheme: ResolvedTheme
  colorMode: ColorMode
  setThemePreference: (value: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

const STORAGE_KEY = "ai-story-builder-theme"

interface ThemeProviderProps {
  projectLoaded: boolean
  children: React.ReactNode
}

export function ThemeProvider({ children, projectLoaded }: ThemeProviderProps) {
  const systemColorMode = useSystemColorMode()

  const [localStorageSetting, setLocalStorageSetting] = useState<ThemePreference | null>(
    localStorage.getItem(STORAGE_KEY) as ThemePreference | null,
  )

  const projectSetting = trpc.settings.uiTheme.get.useQuery(undefined, {
    enabled: projectLoaded,
  })

  const actualThemePreference = useMemo<ThemePreference>(() => {
    if (projectSetting.isFetched && projectSetting.data) {
      return projectSetting.data
    }
    if (localStorageSetting) {
      return localStorageSetting
    }
    return "auto"
  }, [projectSetting.isFetched, projectSetting.data, localStorageSetting])

  // Sync preference to Electron native menu on mount and on change
  const setMenuStateTheme = trpc.native.menuState.theme.set.useMutation()
  useEffect(() => {
    setMenuStateTheme.mutate(actualThemePreference)
  }, [actualThemePreference, setMenuStateTheme])

  const actualResolvedTheme = useMemo<ResolvedTheme>(() => {
    if (actualThemePreference !== "auto") {
      return actualThemePreference
    }
    return DEFAULT_THEME_BY_MODE[systemColorMode]
  }, [actualThemePreference, systemColorMode])

  // Apply resolved theme to <html>
  useEffect(() => {
    const root = window.document.documentElement
    if (root.getAttribute("data-theme") !== actualResolvedTheme) {
      root.setAttribute("data-theme", actualResolvedTheme)
    }

    const requiredClass = THEME_TO_MODE[actualResolvedTheme]
    if (!root.classList.contains(requiredClass)) {
      root.classList.remove(...COLOR_MODES_VALUES)
      root.classList.add(THEME_TO_MODE[actualResolvedTheme])
    }
  }, [actualResolvedTheme])

  const projectSettingUtils = trpc.useUtils().settings
  const projectSettingSet = trpc.settings.uiTheme.set.useMutation({
    onSettled() {
      projectSettingUtils.invalidate()
    },
  })

  const handleChandgeTheme = useCallback(
    (newTheme: ThemePreference) => {
      if (localStorageSetting !== newTheme) {
        localStorage.setItem(STORAGE_KEY, newTheme)
        setLocalStorageSetting(newTheme)
      }
      if (projectSetting.isFetched && projectSetting.data !== newTheme) {
        projectSettingSet.mutate(newTheme)
      }
    },
    [localStorageSetting, projectSetting.isFetched, projectSetting.data, projectSettingSet],
  )

  trpc.native.menuState.theme.subscribe.useSubscription(undefined, {
    onData: handleChandgeTheme,
  })

  return (
    <ThemeContext.Provider
      value={{
        themePreference: actualThemePreference,
        resolvedTheme: actualResolvedTheme,
        colorMode: THEME_TO_MODE[actualResolvedTheme],
        setThemePreference: handleChandgeTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider")
  return ctx
}
