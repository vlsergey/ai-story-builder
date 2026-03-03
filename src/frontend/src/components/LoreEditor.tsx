import React, { useEffect, useState } from 'react'
import DiffViewer from './DiffViewer'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'
import { LoreNode, LoreVersion } from '../types/models'

// Minimal markdown editor for lore node versions.
export default function LoreEditor({ loreNode }: { loreNode: LoreNode }) {
  const [latest, setLatest] = useState<LoreVersion | null>(null)
  const [content, setContent] = useState<string>('')
  const [saving, setSaving] = useState<boolean>(false)
  const [versions, setVersions] = useState<LoreVersion[]>([])
  const [diffTarget, setDiffTarget] = useState<LoreVersion | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { loadLatest(); loadVersions() }, [loreNode])

  function loadVersions() {
    fetch(`/api/lore_nodes/${loreNode.id}/versions`)
      .then(r => r.json()).then(setVersions).catch(() => setVersions([]))
  }

  function loadLatest() {
    fetch(`/api/lore_nodes/${loreNode.id}/latest`)
      .then(r => r.json())
      .then((j: LoreVersion | null) => { setLatest(j); setContent(j ? j.content : '') })
      .catch(() => { setLatest(null); setContent('') })
  }

  async function saveNewVersion() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/lore_nodes/${loreNode.id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      const j = await res.json() as { error?: string }
      if (res.ok) { loadLatest(); loadVersions() }
      else setError('Save error: ' + (j.error || JSON.stringify(j)))
    } catch (e) { setError('Save failed: ' + (e as Error).message) }
    setSaving(false)
  }

  function restoreVersion(versionId: number) {
    fetch(`/api/lore_nodes/restore/${versionId}`, { method: 'POST' })
      .then(r => r.json())
      .then(() => { loadLatest(); loadVersions() })
  }

  return (
    <div className="p-4 bg-background">
      <h3 className="text-xl font-semibold mb-2">{loreNode.name}</h3>
      {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
      <div className="mb-4 flex space-x-2">
        <Button variant="link" className="p-0 h-auto" onClick={loadLatest}>Reload latest</Button>
        <Button variant="link" className="p-0 h-auto" onClick={saveNewVersion} disabled={saving}>
          {saving ? 'Saving...' : 'Save new version'}
        </Button>
      </div>
      <Textarea value={content} onChange={e => setContent(e.target.value)} className="h-48 mb-4" />
      {versions.length > 0 && (
        <>
          <h4 className="font-semibold mb-2">History</h4>
          <ul className="list-disc pl-5 space-y-1">
            {versions.map(v => (
              <li key={v.id} className="text-sm">
                <strong>v{v.version}</strong>{' '}
                <em className="text-muted-foreground">{v.created_at}</em>
                <Button variant="link" size="sm" className="ml-2 p-0 h-auto" onClick={() => setDiffTarget(v)}>diff</Button>
                <Button variant="link" size="sm" className="ml-2 p-0 h-auto" onClick={() => restoreVersion(v.id)}>restore</Button>
              </li>
            ))}
          </ul>
        </>
      )}
      {!latest && (
        <p className="text-muted-foreground text-sm">No content yet. Start typing and save a version.</p>
      )}
      {diffTarget && (
        <div className="mt-4">
          <h5 className="font-semibold mb-2">Diff (v{diffTarget.version})</h5>
          <DiffViewer
            oldText={versions.find(x => x.version === diffTarget.version - 1)?.content || ''}
            newText={diffTarget.content}
          />
        </div>
      )}
    </div>
  )
}
