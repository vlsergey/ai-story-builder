import React, { createContext, useContext } from 'react'

export interface EditorSettings {
  wordWrap: boolean
}

export const EditorSettingsContext = createContext<EditorSettings>({ wordWrap: true })

export function useEditorSettings(): EditorSettings {
  return useContext(EditorSettingsContext)
}
