import { useState } from "react"
import StartScreen from "./pages/StartScreen"
import Layout from "./Layout"
import "./styles.css"
import { ThemeProvider } from "./lib/theme/theme-provider"
import { LocaleProvider } from "./i18n/locale"
import { trpc } from "./ipcClient"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ipcLink } from "electron-trpc/renderer"
import EventsListener from "./EventsListener"

const queryClient = new QueryClient()

/**
 * Root application component
 * - Renders initial Start screen where user can open/upload project DB
 * - After opening a project, displays the main `Layout` (left/center/right/bottom panels)
 * - Locale is managed by LocaleProvider (persisted to localStorage)
 */
export default function App() {
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [ipcLink()],
    }),
  )

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ProjectLoadCheck />
        <EventsListener />
      </QueryClientProvider>
    </trpc.Provider>
  )
}

function ProjectLoadCheck() {
  const projectStatus = trpc.project.status.useQuery()

  if (projectStatus.isLoading) {
    return (
      <LocaleProvider>
        <div className="app-root h-full flex items-center justify-center">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      </LocaleProvider>
    )
  }

  return (
    <ThemeProvider projectLoaded={projectStatus.data?.isOpen || false}>
      <LocaleProvider>
        <div className="app-root h-full">{projectStatus.data?.isOpen ? <Layout /> : <StartScreen />}</div>
      </LocaleProvider>
    </ThemeProvider>
  )
}
