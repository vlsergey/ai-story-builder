import React, { useEffect, useState } from 'react'
import { Button } from './ui/button'
import { LoreFolderNode, LoreItem } from '../types/models'

// Simple folder tree. Props:
// - `onSelectLoreItem(loreItem)` callback invoked when a lore item is selected
export default function LoreFolderTree({ onSelectLoreItem }: { onSelectLoreItem: (item: LoreItem) => void }) {
  const [tree, setTree] = useState<LoreFolderNode[]>([])
  const [selectedFolder, setSelectedFolder] = useState<number | null>(null)
  const [items, setItems] = useState<LoreItem[]>([])
  const [importError, setImportError] = useState<string | null>(null)

  useEffect(() => { fetchTree() }, [])

  function fetchTree() {
    fetch('/api/lore_folders/tree').then(r => r.json()).then(setTree).catch(() => setTree([]))
  }

  function fetchItems(folderId: number) {
    setSelectedFolder(folderId)
    fetch(`/api/lore_folders/${folderId}/lore_items`).then(r => r.json()).then(setItems).catch(() => setItems([]))
  }

  // Drag-and-drop handlers for moving folders
  function handleDragStart(e: React.DragEvent<HTMLLIElement>, node: LoreFolderNode) {
    e.dataTransfer.setData('application/x-folder-id', String(node.id))
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragOver(e: React.DragEvent<HTMLElement>) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }

  function handleDrop(e: React.DragEvent<HTMLElement>, targetNode: LoreFolderNode) {
    e.preventDefault()
    const data = e.dataTransfer.getData('application/x-folder-id')
    if (!data) return
    const sourceId = data
    fetch('/api/lore_folders/' + sourceId + '/move', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parent_id: targetNode.id })
    }).then(r => r.json()).then(() => fetchTree()).catch(err => console.error(err))
  }

  function renderNode(node: LoreFolderNode) {
    return (
      <li key={node.id} draggable
        onDragStart={e => handleDragStart(e, node)}
        onDragOver={handleDragOver}
        onDrop={e => handleDrop(e, node)}
        className="pl-2"
      >
        <div className="cursor-pointer hover:bg-secondary rounded px-1 py-1 text-sm" onClick={() => fetchItems(node.id)}>{node.name}</div>
        {node.children && node.children.length > 0 && (
          <ul className="ml-4 mt-1">{node.children.map(renderNode)}</ul>
        )}
      </li>
    )
  }

  return (
    <div className="border border-border rounded p-2 bg-background">
      <div className="max-h-52 overflow-auto">
        <ul>{Array.isArray(tree) ? tree.map(renderNode) : null}</ul>
      </div>

      <h4 className="font-semibold mt-3 mb-2">Lore files</h4>
      <div className="max-h-52 overflow-auto">
        <ul className="space-y-1">
          {items.map(it => (
            <li key={it.id}>
              <Button variant="link" className="p-0 h-auto text-sm" onClick={() => onSelectLoreItem(it)}>
                {it.title || it.slug}
              </Button>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3">
        <h5 className="font-medium mb-1">Import file to selected folder</h5>
        {importError && <p className="mb-1 text-sm text-destructive">{importError}</p>}
        <input
          type="file"
          className="text-sm"
          onChange={e => {
            const f = e.target.files?.[0]
            setImportError(null)
            if (!f || !selectedFolder) { setImportError('Select a folder first'); return }
            const fd = new FormData()
            fd.append('file', f)
            fd.append('folder_id', String(selectedFolder))
            fetch('/api/lore_items/import', { method: 'POST', body: fd })
              .then(r => r.json())
              .then(() => fetchItems(selectedFolder))
              .catch(err => { setImportError('Import failed'); console.error(err) })
          }}
        />
      </div>
    </div>
  )
}
