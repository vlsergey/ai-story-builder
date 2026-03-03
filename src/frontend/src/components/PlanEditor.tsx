import React, { useEffect, useState } from 'react'
import DiffViewer from './DiffViewer'
import GeneratedPartEditor from './GeneratedPartEditor'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'
import { Label } from './ui/label'
import { PlanNodeTree, PlanNodeVersion, StoryPart } from '../types/models'

export default function PlanEditor({ planNode }: { planNode: PlanNodeTree }) {
  const [versions, setVersions] = useState<PlanNodeVersion[]>([])
  const [instruction, setInstruction] = useState<string>('')
  const [result, setResult] = useState<string>('')
  const [busy, setBusy] = useState<boolean>(false)
  const [diffTarget, setDiffTarget] = useState<PlanNodeVersion | null>(null)
  const [selectedVersion, setSelectedVersion] = useState<PlanNodeVersion | null>(null)
  const [generatedParts, setGeneratedParts] = useState<StoryPart[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { if (planNode) loadVersions() }, [planNode])

  async function loadGenerated(versionId: number) {
    const res = await fetch(`/api/plan_node_versions/${versionId}/generated_parts`)
    const j = await res.json() as StoryPart[]
    setGeneratedParts(j)
  }

  function loadVersions() {
    fetch(`/api/plan/nodes/${planNode.id}/versions`).then(r => r.json()).then(setVersions).catch(() => setVersions([]))
  }

  async function createVersion(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/plan/nodes/${planNode.id}/versions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instruction, result }) })
      const j = await res.json() as { id: number; error?: string }
      if (res.ok) {
        loadVersions(); setInstruction(''); setResult('');
        const gen = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan_node_version_id: j.id, prompt: instruction }) })
        await gen.text()
      } else setError('Create version error: ' + (j.error || JSON.stringify(j)))
    } catch (e) { setError('Create failed: ' + (e as Error).message) }
    setBusy(false)
  }

  if (!planNode) return <div className="p-4 text-muted-foreground">Select a plan node to edit</div>

  function restoreVersion(id: number) {
    fetch('/api/plan/restore/node_version/' + id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      .then(r => r.json()).then(() => loadVersions())
  }

  return (
    <div className="p-4 bg-background">
      <h3 className="text-xl font-semibold mb-2">{planNode.title}</h3>
      {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
      <div className="mb-4">
        <form onSubmit={createVersion} className="space-y-3">
          <div>
            <Label className="mb-1">Instruction</Label>
            <Textarea
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              className="h-20"
            />
          </div>
          <div>
            <Label className="mb-1">Result</Label>
            <Textarea
              value={result}
              onChange={e => setResult(e.target.value)}
              className="h-20"
            />
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? 'Creating...' : 'Create version and regenerate'}
          </Button>
        </form>
      </div>

      <h4 className="font-semibold mb-2">Versions</h4>
      <ul className="list-disc pl-5 space-y-1">
        {versions.map(v => (
          <li key={v.id} className="text-sm">
            <strong>v{v.version}</strong> — {v.instruction || '(no instruction)'} <em className="text-muted-foreground">({v.created_at})</em>
            <Button variant="link" size="sm" className="ml-2 p-0 h-auto" onClick={() => setDiffTarget(v)}>
              diff
            </Button>
            <Button variant="link" size="sm" className="ml-2 p-0 h-auto" onClick={() => restoreVersion(v.id)}>
              restore
            </Button>
            <Button variant="link" size="sm" className="ml-2 p-0 h-auto" onClick={() => { setSelectedVersion(v); loadGenerated(v.id) }}>
              view parts
            </Button>
          </li>
        ))}
      </ul>
      {diffTarget && (
        <div className="mt-4">
          <h5 className="font-semibold mb-2">Diff (v{diffTarget.version})</h5>
          <DiffViewer oldText={versions.find(x=>x.version===diffTarget.version-1)?.result || ''} newText={diffTarget.result || ''} />
        </div>
      )}
      {selectedVersion && (
        <div className="mt-4">
          <h4 className="font-semibold mb-2">Generated Parts for v{selectedVersion.version}</h4>
          <ul className="list-disc pl-5 space-y-1">
            {generatedParts.map(p => (
              <li key={p.id}>
                <Button variant="link" className="p-0 h-auto" onClick={() => setGeneratedParts([p])}>
                  {p.title || `Part ${p.id}`}
                </Button>
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
