import React, { createContext, useContext, useEffect, useState } from 'react'

const WORD_WRAP_KEY = 'ai-story-builder-word-wrap'

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
    return saved === null ? true : saved === 'true'
  })

  // Sync wordWrap to Electron native menu checkbox on mount/change
  useEffect(() => {
    window.electronAPI?.sendMenuState?.('word-wrap', wordWrap)
  }, [wordWrap])

  // Handle set-word-wrap:* IPC from Electron menu.
  useEffect(() => {
    if (!window.electronAPI) return
    const unsub = window.electronAPI.onMenuAction((action: string) => {
      if (!action.startsWith('set-word-wrap:')) return
      const value = action === 'set-word-wrap:true'
      localStorage.setItem(WORD_WRAP_KEY, String(value))
      setWordWrap(value)
    })
    return unsub
  }, [])

  return (
    <EditorSettingsContext.Provider value={{ wordWrap }}>
      {children}
    </EditorSettingsContext.Provider>
  )
}
