import React, { useEffect, useState } from 'react'
import DiffViewer from './DiffViewer'

// Minimal markdown editor for lore versions. Props:
// - `loreItem` - selected lore item object { id, slug, title }
export default function LoreEditor({ loreItem }) {
  const [latest, setLatest] = useState(null)
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [versions, setVersions] = useState([])
  const [diffTarget, setDiffTarget] = useState(null)

  useEffect(() => { if (loreItem) { loadLatest(); loadVersions() } }, [loreItem])

  function loadVersions() {
    fetch(`/api/lore_items/${loreItem.id}/versions`).then(r => r.json()).then(setVersions).catch(() => setVersions([]))
  }

  function loadLatest() {
    fetch(`/api/lore_items/${loreItem.id}/latest`).then(r => r.json()).then(j => { setLatest(j); setContent(j ? j.content : '') }).catch(() => { setLatest(null); setContent('') })
  }

  async function saveNewVersion() {
    setSaving(true)
    try {
      const res = await fetch(`/api/lore_items/${loreItem.id}/versions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) })
      const j = await res.json()
      if (res.ok) {
        loadLatest()
        loadVersions()
        alert('Saved version ' + j.version)
      } else alert('Save error: ' + (j.error || JSON.stringify(j)))
    } catch (e) { alert('Save failed: ' + e.message) }
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
      <div className="mb-4 flex space-x-2">
        <button 
          className="text-sm text-primary hover:underline"
          onClick={loadLatest}
        >
          Reload latest
        </button>
        <button 
          className="text-sm text-primary hover:underline"
          onClick={saveNewVersion} 
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save new version'}
        </button>
      </div>
      <textarea 
        value={content} 
        onChange={e => setContent(e.target.value)} 
        className="w-full h-48 border border-border p-2 mb-4 bg-background text-foreground rounded"
      />
      <h4 className="font-semibold mb-2">History</h4>
      <ul className="list-disc pl-5 space-y-1">
        {versions.map(v => (
          <li key={v.id} className="text-sm">
            <strong>v{v.version}</strong> <em className="text-muted-foreground">{v.created_at}</em>
            <button 
              className="ml-2 text-primary hover:underline"
              onClick={() => setDiffTarget(v)}
            >
              diff
            </button>
            <button 
              className="ml-2 text-primary hover:underline"
              onClick={() => restoreVersion(v.id)}
            >
              restore
            </button>
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
