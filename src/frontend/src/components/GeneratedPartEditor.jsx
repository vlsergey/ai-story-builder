import React, { useEffect, useState } from 'react'

export default function GeneratedPartEditor({ part }) {
  const [content, setContent] = useState(part.content || '')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/generated_parts/' + part.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) })
      const j = await res.json()
      if (!res.ok) alert('Save error: ' + (j.error || JSON.stringify(j)))
    } catch (e) { alert('Save failed: ' + e.message) }
    setSaving(false)
  }

  return (
    <div className="p-4 bg-background border border-border rounded">
      <h5 className="font-semibold mb-2">{part.title || `Part ${part.id}`}</h5>
      <textarea 
        value={content} 
        onChange={e => setContent(e.target.value)} 
        className="w-full h-40 border border-border p-2 mb-2 bg-background text-foreground rounded"
      />
      <button 
        className="px-3 py-1 rounded text-sm bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        onClick={save} 
        disabled={saving}
      >
        {saving ? 'Saving...' : 'Save'}
      </button>
    </div>
  )
}
