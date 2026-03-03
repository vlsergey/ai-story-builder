import React, { useEffect, useState } from 'react'
import DiffViewer from './DiffViewer'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'

// Minimal markdown editor for lore versions. Props:
// - `loreItem` - selected lore item object { id, slug, title }
export default function LoreEditor({ loreItem }) {
  const [latest, setLatest] = useState(null)
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [versions, setVersions] = useState([])
  const [diffTarget, setDiffTarget] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => { if (loreItem) { loadLatest(); loadVersions() } }, [loreItem])

  function loadVersions() {
    fetch(`/api/lore_items/${loreItem.id}/versions`).then(r => r.json()).then(setVersions).catch(() => setVersions([]))
  }

  function loadLatest() {
    fetch(`/api/lore_items/${loreItem.id}/latest`).then(r => r.json()).then(j => { setLatest(j); setContent(j ? j.content : '') }).catch(() => { setLatest(null); setContent('') })
  }

  async function saveNewVersion() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/lore_items/${loreItem.id}/versions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) })
      const j = await res.json()
      if (res.ok) {
        loadLatest()
        loadVersions()
      } else setError('Save error: ' + (j.error || JSON.stringify(j)))
    } catch (e) { setError('Save failed: ' + e.message) }
    setSaving(false)
  }

  if (!loreItem) return <div className="p-4 text-muted-foreground">Select a lore file to edit</div>

  function restoreVersion(id) {
    fetch('/api/restore/lore_version/' + id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      .then(r => r.json()).then(() => { loadLatest(); loadVersions(); })
  }

  return (
    <div className="p-4 bg-background">
      <h3 className="text-xl font-semibold mb-2">{loreItem.title || loreItem.slug}</h3>
      {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
      <div className="mb-4 flex space-x-2">
        <Button variant="link" className="p-0 h-auto" onClick={loadLatest}>
          Reload latest
        </Button>
        <Button variant="link" className="p-0 h-auto" onClick={saveNewVersion} disabled={saving}>
          {saving ? 'Saving...' : 'Save new version'}
        </Button>
      </div>
      <Textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        className="h-48 mb-4"
      />
      <h4 className="font-semibold mb-2">History</h4>
      <ul className="list-disc pl-5 space-y-1">
        {versions.map(v => (
          <li key={v.id} className="text-sm">
            <strong>v{v.version}</strong> <em className="text-muted-foreground">{v.created_at}</em>
            <Button variant="link" size="sm" className="ml-2 p-0 h-auto" onClick={() => setDiffTarget(v)}>
              diff
            </Button>
            <Button variant="link" size="sm" className="ml-2 p-0 h-auto" onClick={() => restoreVersion(v.id)}>
              restore
            </Button>
          </li>
        ))}
      </ul>
      {diffTarget && (
        <div className="mt-4">
          <h5 className="font-semibold mb-2">Diff (v{diffTarget.version})</h5>
          <DiffViewer oldText={versions.find(x=>x.version===diffTarget.version-1)?.content || ''} newText={diffTarget.content} />
        </div>
      )}
    </div>
  )
}
