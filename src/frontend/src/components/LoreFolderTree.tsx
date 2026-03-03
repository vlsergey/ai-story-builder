import React, { useEffect, useState } from 'react'
import { Library, BookOpen, ScrollText, ChevronRight, ChevronDown } from 'lucide-react'
import { Button } from './ui/button'
import { LoreFolderNode, LoreItem } from '../types/models'

function collectAllIds(nodes: LoreFolderNode[]): Set<number> {
  const ids = new Set<number>()
  function walk(list: LoreFolderNode[]) {
    list.forEach(n => { ids.add(n.id); if (n.children?.length) walk(n.children) })
  }
  walk(nodes)
  return ids
}

// Simple folder tree. Props:
// - `onSelectLoreItem(loreItem)` callback invoked when a lore item is selected
export default function LoreFolderTree({ onSelectLoreItem }: { onSelectLoreItem: (item: LoreItem) => void }) {
  const [tree, setTree] = useState<LoreFolderNode[]>([])
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [selectedFolder, setSelectedFolder] = useState<number | null>(null)
  const [items, setItems] = useState<LoreItem[]>([])
  const [importError, setImportError] = useState<string | null>(null)

  useEffect(() => { fetchTree() }, [])

  function fetchTree() {
    fetch('/api/lore_folders/tree')
      .then(r => r.json())
      .then((data: LoreFolderNode[]) => {
        setTree(data)
        setExpanded(collectAllIds(data)) // expand all by default
      })
      .catch(() => setTree([]))
  }

  function fetchItems(folderId: number) {
    setSelectedFolder(folderId)
    fetch(`/api/lore_folders/${folderId}/lore_items`).then(r => r.json()).then(setItems).catch(() => setItems([]))
  }

  function toggleExpanded(id: number) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
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
    fetch('/api/lore_folders/' + data + '/move', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parent_id: targetNode.id })
    }).then(r => r.json()).then(() => fetchTree()).catch(err => console.error(err))
  }

  function renderNode(node: LoreFolderNode) {
    const hasChildren = (node.children?.length ?? 0) > 0
    const isExpanded = expanded.has(node.id)
    const Icon = node.parent_id === null ? Library : BookOpen

    return (
      <li key={node.id} draggable
        onDragStart={e => handleDragStart(e, node)}
        onDragOver={handleDragOver}
        onDrop={e => handleDrop(e, node)}
      >
        <div className="flex items-center">
          {/* Expand/collapse chevron — always 16px wide for alignment */}
          <button
            className="flex items-center justify-center w-4 h-4 shrink-0 text-muted-foreground hover:text-foreground"
            tabIndex={-1}
            onClick={() => hasChildren && toggleExpanded(node.id)}
          >
            {hasChildren && (isExpanded
              ? <ChevronDown size={12} />
              : <ChevronRight size={12} />
            )}
          </button>

          {/* Icon + label */}
          <div
            className="flex items-center gap-1.5 flex-1 cursor-pointer hover:bg-secondary rounded px-1 py-0.5 text-sm"
            onClick={() => fetchItems(node.id)}
          >
            <Icon size={14} className="shrink-0 text-muted-foreground" />
            {node.name}
          </div>
        </div>

        {hasChildren && isExpanded && (
          <ul className="ml-4 border-l border-border/50 pl-1 mt-0.5">
            {node.children!.map(renderNode)}
          </ul>
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
              <Button
                variant="link"
                className="flex items-center gap-1.5 p-0 h-auto text-sm"
                onClick={() => onSelectLoreItem(it)}
              >
                <ScrollText size={13} className="shrink-0 text-muted-foreground" />
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
