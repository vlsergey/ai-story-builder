import { trpc } from "@/ipcClient"
import type React from "react"
import { createContext, useContext, useEffect, useState } from "react"

const WORD_WRAP_KEY = "ai-story-builder-word-wrap"

export interface EditorSettings {
  wordWrap: boolean
}

export const EditorSettingsContext = createContext<EditorSettings>({ wordWrap: true })

export function useEditorSettings(): EditorSettings {
  return useContext(EditorSettingsContext)
}

export function EditorSettingsProvider({ children }: { children: React.ReactNode }) {
  const [wordWrap, setWordWrap] = useState<boolean>(() => {
    const saved = localStorage.getItem(WORD_WRAP_KEY)
    return saved === null ? true : saved === "true"
  })

  // Sync wordWrap to Electron native menu checkbox on mount/change
  const setWordWrapMenuState = trpc.native.menuState.wordWrap.set.useMutation()
  useEffect(() => {
    setWordWrapMenuState.mutate(wordWrap)
  }, [setWordWrapMenuState.mutate, wordWrap])

  // Handle set-word-wrap from Electron menu.
  trpc.native.menuState.wordWrap.subscribe.useSubscription(undefined, {
    onData: setWordWrap,
  })

  return <EditorSettingsContext.Provider value={{ wordWrap }}>{children}</EditorSettingsContext.Provider>
}
