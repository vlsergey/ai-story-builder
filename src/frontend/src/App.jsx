import React, { useState, useMemo, useEffect } from 'react'
import { Routes, Route, useNavigate } from 'react-router-dom'
import StartScreen from './pages/StartScreen'
import Layout from './components/Layout'
import en from './i18n/en.json'
import ru from './i18n/ru.json'
import './styles.css'
import { ThemeProvider } from './lib/theme/theme-provider'

/**
 * Root application component
 * - Renders initial Start screen where user can open/upload project DB
 * - After opening a project, displays the main `Layout` (left/center/right/bottom panels)
 * - Locale files are simple JSON maps stored in `src/frontend/src/i18n` (can be extended)
 */
export default function App() {
  const navigate = useNavigate()
  const [projectOpen, setProjectOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [locale, setLocale] = useState('en')

  // Simple locale resolver
  const localeStrings = useMemo(() => (locale === 'ru' ? ru : en), [locale])

  // Check if a project is already open on the server
  useEffect(() => {
    const checkProjectStatus = async () => {
      try {
        const res = await fetch('/api/project/status')
        const data = await res.json()
        setProjectOpen(data.isOpen)
        if (data.isOpen) {
          navigate('/project', { replace: true })
        }
      } catch (e) {
        console.error('Failed to check project status:', e)
      } finally {
        setIsLoading(false)
      }
    }
    checkProjectStatus()
  }, [navigate])

  function handleOpenProject(path) {
    setProjectOpen(true)
    navigate('/project')
  }

  async function handleCloseProject() {
    try {
      const res = await fetch('/api/project/close', { method: 'POST' })
      if (res.ok) {
        setProjectOpen(false)
        navigate('/', { replace: true })
      } else {
        console.error('Failed to close project: API error')
      }
    } catch (e) {
      console.error('Failed to close project:', e)
      // Still close UI even if API fails
      setProjectOpen(false)
      navigate('/', { replace: true })
    }
  }

  if (isLoading) {
    return (
      <ThemeProvider defaultTheme="zinc" storageKey="ai-story-builder-theme">
        <div className="app-root h-full flex items-center justify-center">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      </ThemeProvider>
    )
  }

  return (
    <ThemeProvider defaultTheme="zinc" storageKey="ai-story-builder-theme">
      <div className="app-root h-full">
        <Routes>
          <Route path="/" element={<StartScreen onOpenProject={handleOpenProject} localeStrings={localeStrings} />} />
          <Route path="/project" element={
            projectOpen ? (
              <Layout localeStrings={localeStrings} onClose={handleCloseProject} />
            ) : (
              <StartScreen onOpenProject={handleOpenProject} localeStrings={localeStrings} />
            )
          } />
        </Routes>
      </div>
    </ThemeProvider>
  )
}
