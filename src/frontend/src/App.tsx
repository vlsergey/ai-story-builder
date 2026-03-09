import React, { useState, useEffect } from 'react'
import { Routes, Route, useNavigate } from 'react-router-dom'
import StartScreen from './pages/StartScreen'
import Layout from './components/Layout'
import './styles.css'
import { ThemeProvider } from './lib/theme/theme-provider'
import { LocaleProvider } from './lib/locale'
import { ProjectData } from './types/models'
import { ipcClient } from './ipcClient'

/**
 * Root application component
 * - Renders initial Start screen where user can open/upload project DB
 * - After opening a project, displays the main `Layout` (left/center/right/bottom panels)
 * - Locale is managed by LocaleProvider (persisted to localStorage)
 */
export default function App() {
  const navigate = useNavigate()
  const [projectOpen, setProjectOpen] = useState<boolean>(false)
  const [initialLayout, setInitialLayout] = useState<unknown | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)

  // Check if a project is already open on the server
  useEffect(() => {
    const checkProjectStatus = async () => {
      try {
        const data = await ipcClient.project.status()
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

  function handleOpenProject(path: string, data: ProjectData) {
    setInitialLayout(data?.layout ?? null)
    setProjectOpen(true)
    navigate('/project')
  }

  async function handleCloseProject() {
    try {
      await ipcClient.project.close()
      setProjectOpen(false)
      navigate('/', { replace: true })
    } catch (e) {
      console.error('Failed to close project:', e)
      // Still close UI even if API fails
      setProjectOpen(false)
      navigate('/', { replace: true })
    }
  }

  if (isLoading) {
    return (
      <ThemeProvider>
        <LocaleProvider>
          <div className="app-root h-full flex items-center justify-center">
            <div className="text-muted-foreground">Loading...</div>
          </div>
        </LocaleProvider>
      </ThemeProvider>
    )
  }

  return (
    <ThemeProvider>
      <LocaleProvider>
        <div className="app-root h-full">
          <Routes>
            <Route path="/" element={<StartScreen onOpenProject={handleOpenProject} />} />
            <Route path="/project" element={
              projectOpen ? (
                <Layout onClose={handleCloseProject} initialLayout={initialLayout} />
              ) : (
                <StartScreen onOpenProject={handleOpenProject} />
              )
            } />
          </Routes>
        </div>
      </LocaleProvider>
    </ThemeProvider>
  )
}
