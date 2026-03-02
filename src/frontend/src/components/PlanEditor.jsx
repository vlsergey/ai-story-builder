import React, { useEffect, useState } from 'react'
import DiffViewer from './DiffViewer'
import GeneratedPartEditor from './GeneratedPartEditor'

export default function PlanEditor({ planNode }) {
  const [versions, setVersions] = useState([])
  const [summary, setSummary] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [diffTarget, setDiffTarget] = useState(null)
  const [selectedVersion, setSelectedVersion] = useState(null)
  const [generatedParts, setGeneratedParts] = useState([])
  useEffect(() => { if (planNode) loadVersions() }, [planNode])

  async function loadGenerated(versionId) {
    const res = await fetch(`/api/plan_node_version/${versionId}/generated_parts`)
    const j = await res.json()
    setGeneratedParts(j)
  }

  function loadVersions() {
    fetch(`/api/plan/nodes/${planNode.id}/versions`).then(r => r.json()).then(setVersions).catch(() => setVersions([]))
  }

  async function createVersion(e) {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await fetch(`/api/plan/nodes/${planNode.id}/versions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ summary, notes }) })
      const j = await res.json()
      if (res.ok) {
        loadVersions(); setSummary(''); setNotes('');
        // Optionally regenerate plan result by calling /api/generate with the new plan_node_version_id
        const gen = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan_node_version_id: j.id, prompt: summary }) })
        // ignore response for now
        await gen.text()
      } else alert('Create version error: ' + (j.error || JSON.stringify(j)))
    } catch (e) { alert('Create failed: ' + e.message) }
    setBusy(false)
  }

  if (!planNode) return <div className="p-4 text-muted-foreground">Select a plan node to edit</div>

  function restoreVersion(id) {
    fetch('/api/restore/plan_node_version/' + id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      .then(r => r.json()).then(() => loadVersions())
  }

  return (
    <div className="p-4 bg-background">
      <h3 className="text-xl font-semibold mb-2">{planNode.title}</h3>
      <div className="mb-4">
        <form onSubmit={createVersion} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Summary</label>
            <textarea 
              value={summary} 
              onChange={e => setSummary(e.target.value)} 
              className="w-full h-20 border border-border p-2 bg-background text-foreground rounded"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea 
              value={notes} 
              onChange={e => setNotes(e.target.value)} 
              className="w-full h-20 border border-border p-2 bg-background text-foreground rounded"
            />
          </div>
          <button 
            className="px-3 py-1 rounded text-sm bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            type="submit" 
            disabled={busy}
          >
            {busy ? 'Creating...' : 'Create version and regenerate'}
          </button>
        </form>
      </div>

      <h4 className="font-semibold mb-2">Versions</h4>
      <ul className="list-disc pl-5 space-y-1">
        {versions.map(v => (
          <li key={v.id} className="text-sm">
            <strong>v{v.version}</strong> — {v.summary || '(no summary)'} <em className="text-muted-foreground">({v.created_at})</em>
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
            <button 
              className="ml-2 text-primary hover:underline"
              onClick={() => { setSelectedVersion(v); loadGenerated(v.id) }}
            >
              view parts
            </button>
          </li>
        ))}
      </ul>
      {diffTarget && (
        <div className="mt-4">
          <h5 className="font-semibold mb-2">Diff (v{diffTarget.version})</h5>
          <DiffViewer oldText={versions.find(x=>x.version===diffTarget.version-1)?.notes || ''} newText={diffTarget.notes} />
        </div>
      )}
      {selectedVersion && (
        <div className="mt-4">
          <h4 className="font-semibold mb-2">Generated Parts for v{selectedVersion.version}</h4>
          <ul className="list-disc pl-5 space-y-1">
            {generatedParts.map(p => (
              <li key={p.id}>
                <button 
                  className="text-primary hover:underline"
                  onClick={() => setGeneratedParts([p])}
                >
                  {p.title || `Part ${p.id}`}
                </button>
              </li>
            ))}
          </ul>
          {generatedParts.length===1 && (
            <GeneratedPartEditor part={generatedParts[0]} />
          )}
        </div>
      )}
    </div>
  )
}
