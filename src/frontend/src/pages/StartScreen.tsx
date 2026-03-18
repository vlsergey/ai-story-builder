import React, { useEffect, useState } from 'react'
import { ipcClient } from '../ipcClient'

import { BookOpen, ChevronRight, ExternalLink, FileText, FolderOpen, Plus, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { ProjectData } from '../types/models'
import { useLocale } from '../lib/locale'

/** Returns the project display name from a full filesystem path: basename without extension. */
function projectDisplayName(fullPath: string): string {
  const base = fullPath.split(/[/\\]/).pop() ?? fullPath
  return base.replace(/\.[^.]+$/, '')
}

function CreateNewForm({ onCreated }: { onCreated: (path: string, data: ProjectData) => void }) {
  const navigate = useNavigate()
  const [name, setName] = React.useState('MyProject')
  const [textLanguage, setTextLanguage] = React.useState('ru-RU')
  const [busy, setBusy] = React.useState(false)
  const [createError, setCreateError] = React.useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setCreateError(null)
    try {
      const j = await ipcClient.project.create({ name, text_language: textLanguage }) as ProjectData
      onCreated(j.path, j)
      navigate('/project')
    } catch (err) {
      setCreateError('Create failed: ' + (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <form onSubmit={submit} className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            className="h-8 text-sm"
            placeholder="Project name"
          />
          <Button type="submit" disabled={busy} size="sm" className="shrink-0">
            {busy ? 'Creating…' : 'Create'}
          </Button>
        </div>
        <select
          value={textLanguage}
          onChange={e => setTextLanguage(e.target.value)}
          className="h-8 text-sm rounded-md border border-input bg-background px-3 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="ru-RU">Русский (ru-RU)</option>
          <option value="en-US">English (en-US)</option>
        </select>
      </form>
      {createError && <p className="mt-2 text-xs text-destructive">{createError}</p>}
    </div>
  )
}

export default function StartScreen({
  onOpenProject,
}: {
  onOpenProject: (path: string, data: ProjectData) => void
}) {
  const { t } = useLocale()
  const [recent, setRecent] = useState<string[]>([])
  const [projectsData, setProjectsData] = useState<{ dir: string; files: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ipcClient.project.recent().then(r => setRecent(r)).catch(() => setRecent([]))
    ipcClient.project.files().then(r => setProjectsData(r)).catch(() => setProjectsData(null))
  }, [])

  function openFolder() {
    ipcClient.project.openFolder().catch(console.error)
  }

  async function removeRecent(e: React.MouseEvent, p: string) {
    e.stopPropagation()
    await ipcClient.project.deleteRecent(p)
    setRecent(prev => prev.filter(r => r !== p))
  }

  async function openRecent(path: string) {
    setError(null)
    try {
      const data = await ipcClient.project.open(path) as ProjectData
      onOpenProject(data.path, data)
    } catch (err) {
      setError('Error opening project: ' + (err as Error).message)
    }
  }

  return (
    <div className="min-h-screen flex bg-background text-foreground">

      {/* ── Left panel: branding + recent projects ── */}
      <aside className="w-64 shrink-0 flex flex-col border-r border-border bg-muted/20">

        {/* App identity */}
        <div className="px-5 pt-8 pb-5 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
              <BookOpen className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight">AI Story Builder</p>
              <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                creative writing companion
              </p>
            </div>
          </div>
        </div>

        {/* Recent projects list */}
        <div className="flex-1 overflow-y-auto py-4">
          <p className="px-5 mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t('start.recent')}
          </p>

          {error && (
            <div className="mx-3 mb-3 px-3 py-2 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-xs">
              {error}
            </div>
          )}

          {recent.length === 0 ? (
            <p className="px-5 py-2 text-xs text-muted-foreground">
              {t('start.no_recent')}
            </p>
          ) : (
            <ul className="space-y-0.5 px-2">
              {recent.map(r => (
                <li key={r} className="group/item">
                  <button
                    onClick={() => openRecent(r)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm hover:bg-accent transition-colors text-left group"
                  >
                    <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />
                    <span className="truncate flex-1">{projectDisplayName(r)}</span>
                    <ChevronRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 group-hover/item:hidden" />
                    <button
                      onClick={e => removeRecent(e, r)}
                      title="Remove from list"
                      className="h-4 w-4 shrink-0 hidden group-hover/item:flex items-center justify-center rounded text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* ── Right panel: create new + projects folder ── */}
      <main className="flex-1 flex flex-col overflow-y-auto">

        {/* Page header */}
        <div className="px-10 pt-10 pb-8">
          <h2 className="text-2xl font-bold tracking-tight">
            {t('start.title')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Start a new story or continue an existing one.
          </p>
        </div>

        <div className="px-10 pb-10 flex flex-col gap-8 max-w-lg">

          {/* ── Create new project ── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Plus className="h-4 w-4 text-primary shrink-0" />
              <h3 className="text-sm font-semibold">
                {t('start.create')}
              </h3>
            </div>
            <CreateNewForm onCreated={(p, data) => onOpenProject(p, data)} />
          </section>

          <div className="border-t border-border" />

          {/* ── Projects folder ── */}
          <section>
            <div className="flex items-center gap-2 mb-1">
              <FolderOpen className="h-4 w-4 text-primary shrink-0" />
              <h3 className="text-sm font-semibold">
                {t('start.projects_folder')}
              </h3>
              <button
                onClick={openFolder}
                title="Open in file manager"
                className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                Show in explorer
              </button>
            </div>

            {projectsData && (
              <p className="text-[11px] text-muted-foreground mb-3 pl-6 break-all">
                {projectsData.dir}
              </p>
            )}

            {!projectsData || projectsData.files.length === 0 ? (
              <p className="pl-6 text-sm text-muted-foreground">
                {t('start.no_files')}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {projectsData.files.map(f => (
                  <li key={f}>
                    <button
                      onClick={() => openRecent(f)}
                      className="w-full flex items-center gap-2.5 pl-6 pr-2 py-1.5 rounded-md text-sm hover:bg-accent transition-colors text-left group"
                    >
                      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />
                      <span className="truncate flex-1">{projectDisplayName(f)}</span>
                      <ChevronRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

        </div>
      </main>
    </div>
  )
}
