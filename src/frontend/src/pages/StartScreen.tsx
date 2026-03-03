import React, { useEffect, useState } from 'react'
import api from '../api'

import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { ProjectData, LocaleStrings } from '../types/models'

/** Returns the project display name from a full filesystem path: basename without extension. */
function projectDisplayName(fullPath: string): string {
  const base = fullPath.split(/[/\\]/).pop() ?? fullPath
  return base.replace(/\.[^.]+$/, '')
}

export default function StartScreen({ onOpenProject, localeStrings }: { onOpenProject: (path: string, data: ProjectData) => void; localeStrings: LocaleStrings }) {
  const navigate = useNavigate()
  const [recent, setRecent] = useState<string[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get<string[]>('/project/recent').then(r => setRecent(r)).catch(() => setRecent([]))
  }, [])

  function upload(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return
    setStatus('uploading')
    setError(null)

    const fd = new FormData()
    fd.append('dbfile', file)
    fetch('/api/project/upload', { method: 'POST', body: fd })
      .then(r => r.json())
      .then((j: ProjectData) => {
        setStatus('done')
        onOpenProject(j.path, j)
        navigate('/project')
      })
      .catch((err: Error) => { setStatus('error'); setError(err.message); console.error(err) })
  }


function CreateNewForm({ onCreated }: { onCreated: (path: string, data: ProjectData) => void }) {
  const [name, setName] = React.useState('MyProject')
  const [busy, setBusy] = React.useState(false)
  const [createError, setCreateError] = React.useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/project/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      const j = await res.json() as ProjectData & { error?: string }
      if (res.ok) {
        onCreated(j.path, j)
        navigate('/project')
      } else setCreateError('Error creating project: ' + (j.error || JSON.stringify(j)))
    } catch (err) {
      setCreateError('Create failed: ' + (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <form onSubmit={submit} className="flex items-center space-x-2">
        <Input
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <Button type="submit" disabled={busy}>
          {busy ? 'Creating...' : 'Create'}
        </Button>
      </form>
      {createError && <p className="mt-1 text-sm text-destructive">{createError}</p>}
    </div>
  )
}

  async function openRecent(path: string) {
    setError(null)
    try {
      const res = await fetch('/api/project/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      })
      const text = await res.text()
      let data: ProjectData & { error?: string }
      try {
        data = JSON.parse(text)
      } catch (e) {
        console.error('Failed to parse response:', text)
        setError('Error opening project: Invalid response from server')
        return
      }
      if (res.ok) {
        onOpenProject(data.path, data)
        navigate('/project')
      } else {
        setError('Failed to open project: ' + (data.error || 'Unknown error'))
      }
    } catch (err) {
      setError('Error opening project: ' + (err as Error).message)
      console.error(err)
    }
  }

  return (
    <div className="p-6 max-w-xl mx-auto bg-background text-foreground min-h-screen">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">{localeStrings['start.title'] || 'Open project'}</h2>
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <section className="mb-6">
        <h3 className="text-xl font-semibold mb-2">{localeStrings['start.recent'] || 'Recent projects'}</h3>
        <ul className="list-disc pl-5 space-y-1">
          {recent.length === 0 && <li className="text-muted-foreground">{localeStrings['start.no_recent'] || 'No recent projects'}</li>}
          {recent.map(r => (
            <li key={r}>
              <Button variant="link" className="p-0 h-auto" onClick={() => openRecent(r)}>
                {projectDisplayName(r)}
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-6">
        <h3 className="text-xl font-semibold mb-2">{localeStrings['start.create'] || 'Create new project'}</h3>
        <CreateNewForm onCreated={(p, data) => onOpenProject(p, data)} />
      </section>

      <section>
        <h3 className="text-xl font-semibold mb-2">{localeStrings['start.upload'] || 'Upload project DB'}</h3>
        <form onSubmit={upload} className="flex items-center space-x-2">
          <Input
            type="file"
            accept=".sqlite,.db"
            onChange={e => setFile(e.target.files?.[0] ?? null)}
          />
          <Button type="submit">
            {localeStrings['start.upload_btn'] || 'Upload'}
          </Button>
        </form>
        {status && <p className="mt-2 text-sm text-muted-foreground">Status: {status}</p>}
      </section>
    </div>
  )
}
