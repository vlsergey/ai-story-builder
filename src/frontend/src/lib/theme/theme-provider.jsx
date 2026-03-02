import React, { createContext, useContext, useEffect, useState } from 'react'

const ThemeContext = createContext()

export function ThemeProvider({ children, defaultTheme = 'zinc', storageKey = 'vite-ui-theme' }) {
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem(storageKey);
    return savedTheme || defaultTheme;
  });

  useEffect(() => {
    const root = window.document.documentElement

    // handle light/dark mode class used by Tailwind
    const darkThemes = ['obsidian', 'carbon'];
    root.classList.remove('light', 'dark')
    root.classList.add(darkThemes.includes(theme) ? 'dark' : 'light')
    
    // Remove all theme classes
    const themes = ['zinc', 'slate', 'neutral', 'obsidian', 'carbon'];
    themes.forEach(t => root.classList.remove(t));
    
    // Add current theme class and data attribute
    root.classList.add(theme);
    root.setAttribute('data-theme', theme);
  }, [theme])

  const value = {
    theme,
    setTheme: (newTheme) => {
      localStorage.setItem(storageKey, newTheme)
      setTheme(newTheme)
    }
  }

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}