import React, { useEffect, useState } from 'react'
import api from '../api'

import { useNavigate } from 'react-router-dom'
import { useTheme } from '../lib/theme/theme-provider'

export default function StartScreen({ onOpenProject, localeStrings }) {
  const navigate = useNavigate()
  const [recent, setRecent] = useState([])
  const [file, setFile] = useState(null)
  const [status, setStatus] = useState(null)
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    api.get('/project/recent').then(r => setRecent(r)).catch(() => setRecent([]))
  }, [])

  function upload(e) {
    // after upload we should navigate as well
    e.preventDefault()
    if (!file) return
    setStatus('uploading')

    const fd = new FormData()
    fd.append('dbfile', file)
    fetch('/api/project/upload', { method: 'POST', body: fd })
      .then(r => r.json())
      .then(j => {
        setStatus('done')
        onOpenProject(j.path)
        navigate('/project')
      })
      .catch(err => { setStatus('error'); console.error(err) })
  }


function CreateNewForm({ onCreated }) {
  const [name, setName] = React.useState('MyProject')
  const [busy, setBusy] = React.useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await fetch('/api/project/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      const j = await res.json()
      if (res.ok) {
        if (j.reused) alert(localeStrings['start.existing_open'] || 'Project already existed – opening existing DB')
        onCreated(j.path)
        navigate('/project')
      } else alert('Error creating project: ' + (j.error || JSON.stringify(j)))
    } catch (err) {
      alert('Create failed: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex items-center space-x-2">
      <input
        className="border p-2 rounded text-sm bg-background text-foreground border-border"
        value={name}
        onChange={e => setName(e.target.value)}
      />
      <button
        className="px-3 py-1 rounded text-sm bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        type="submit"
        disabled={busy}
      >
        {busy ? 'Creating...' : 'Create'}
      </button>
    </form>
  )
}
  return (
    <div className="p-6 max-w-xl mx-auto bg-background text-foreground min-h-screen">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">{localeStrings['start.title'] || 'Open project'}</h2>
      </div>

      <section className="mb-6">
        <h3 className="text-xl font-semibold mb-2">{localeStrings['start.recent'] || 'Recent projects'}</h3>
        <ul className="list-disc pl-5 space-y-1">
          {recent.length === 0 && <li className="text-muted-foreground">{localeStrings['start.no_recent'] || 'No recent projects'}</li>}
          {recent.map(r => (
            <li key={r}>
              <button
                className="text-primary hover:underline"
                onClick={async () => {
                  try {
                    const res = await fetch('/api/project/open', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ path: r })
                    })
                    const text = await res.text()
                    let data
                    try {
                      data = JSON.parse(text)
                    } catch (e) {
                      console.error('Failed to parse response:', text)
                      alert('Error opening project: Invalid response from server')
                      return
                    }
                    if (res.ok) {
                      onOpenProject(data.path)
                      navigate('/project')
                    } else {
                      alert('Failed to open project: ' + (data.error || 'Unknown error'))
                    }
                  } catch (err) {
                    alert('Error opening project: ' + err.message)
                    console.error(err)
                  }
                }}
              >
                {r}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-6">
        <h3 className="text-xl font-semibold mb-2">{localeStrings['start.create'] || 'Create new project'}</h3>
        <CreateNewForm onCreated={p => onOpenProject(p)} />
      </section>

      {status && <div className="mt-2 text-muted-foreground">{status}</div>}

      <section>
        <h3 className="text-xl font-semibold mb-2">{localeStrings['start.upload'] || 'Upload project DB'}</h3>
        <form onSubmit={upload} className="flex items-center space-x-2">
          <input
            className="border p-2 rounded text-sm bg-background text-foreground border-border"
            type="file"
            accept=".sqlite,.db"
            onChange={e => setFile(e.target.files[0])}
          />
          <button
            className="px-3 py-1 rounded text-sm bg-primary text-primary-foreground hover:bg-primary/90"
            type="submit"
          >
            {localeStrings['start.upload_btn'] || 'Upload'}
          </button>
        </form>
        {status && <div className="mt-2 text-muted-foreground">Status: {status}</div>}
      </section>
    </div>
  )
}
