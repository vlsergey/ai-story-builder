import React, { useState } from 'react'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'
import { StoryPart } from '../types/models'

export default function GeneratedPartEditor({ part }: { part: StoryPart }) {
  const [content, setContent] = useState<string>(part.content || '')
  const [saving, setSaving] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/generated_parts/' + part.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) })
      const j = await res.json() as { error?: string }
      if (!res.ok) setError('Save error: ' + (j.error || JSON.stringify(j)))
    } catch (e) { setError('Save failed: ' + (e as Error).message) }
    setSaving(false)
  }

  return (
    <div className="p-4 bg-background border border-border rounded">
      <h5 className="font-semibold mb-2">{part.title || `Part ${part.id}`}</h5>
      {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
      <Textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        className="h-40 mb-2"
      />
      <Button onClick={save} disabled={saving}>
        {saving ? 'Saving...' : 'Save'}
      </Button>
    </div>
  )
}
