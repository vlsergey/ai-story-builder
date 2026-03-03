import React, { useEffect, useRef, useState } from 'react'
import {
  ChevronRight, ChevronDown,
  Library, BookOpen, ScrollText,
  Plus, CopyPlus, Pencil, Upload, Download, Trash2, CloudUpload, ArrowUpAZ,
} from 'lucide-react'
import { LoreNode } from '../types/models'

// ── Command system ────────────────────────────────────────────────────────────

interface LoreCommand {
  id: string
  label: string
  icon: React.ReactElement
  shortcut?: string
  enabled: boolean
  variant?: 'default' | 'destructive' | 'primary'
  execute: () => void | Promise<void>
}

type ToolbarItem = LoreCommand | 'separator' | 'spacer'

// ── Tree helpers ──────────────────────────────────────────────────────────────

function collectAllIds(nodes: LoreNode[]): Set<number> {
  const ids = new Set<number>()
  function walk(list: LoreNode[]) {
    list.forEach(n => { ids.add(n.id); if (n.children?.length) walk(n.children) })
  }
  walk(nodes)
  return ids
}

/** Pre-order traversal — used for Shift+click range. */
function collectNodeOrder(nodes: LoreNode[]): number[] {
  const order: number[] = []
  function walk(list: LoreNode[]) {
    list.forEach(n => { order.push(n.id); if (n.children?.length) walk(n.children) })
  }
  walk(nodes)
  return order
}

function findNode(id: number, nodes: LoreNode[]): LoreNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    if (n.children?.length) { const f = findNode(id, n.children); if (f) return f }
  }
  return null
}

/**
 * Icon rules (independent of depth/root status):
 *   - No children              → ScrollText  (a single scroll / leaf)
 *   - All children are leaves  → BookOpen    (a book containing scrolls)
 *   - Some children have kids  → Library     (a bookshelf / collection)
 */
function nodeIcon(node: LoreNode): typeof Library {
  const children = node.children ?? []
  if (children.length === 0) return ScrollText
  const allLeaves = children.every(c => (c.children?.length ?? 0) === 0)
  return allLeaves ? BookOpen : Library
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function LoreFolderTree({ onSelectLoreNode }: { onSelectLoreNode: (node: LoreNode) => void }) {
  const [tree, setTree] = useState<LoreNode[]>([])
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<number>>(new Set())
  const [lastClickedId, setLastClickedId] = useState<number | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { fetchTree() }, [])

  function fetchTree() {
    fetch('/api/lore_nodes/tree')
      .then(r => r.json())
      .then((data: LoreNode[]) => { setTree(data); setExpanded(collectAllIds(data)) })
      .catch(() => setTree([]))
  }

  // ── Selection (plain / Ctrl / Shift) ─────────────────────────────────────────

  function handleNodeClick(e: React.MouseEvent, node: LoreNode) {
    // Open in editor whenever node is clicked (editor handles no-content state)
    onSelectLoreNode(node)

    if (e.shiftKey && lastClickedId !== null) {
      const order = collectNodeOrder(tree)
      const a = order.indexOf(lastClickedId)
      const b = order.indexOf(node.id)
      const range = order.slice(Math.min(a, b), Math.max(a, b) + 1)
      setSelectedNodeIds(prev => { const next = new Set(prev); range.forEach(id => next.add(id)); return next })
    } else if (e.ctrlKey || e.metaKey) {
      setSelectedNodeIds(prev => {
        const next = new Set(prev)
        if (next.has(node.id)) next.delete(node.id); else next.add(node.id)
        return next
      })
      setLastClickedId(node.id)
    } else {
      setSelectedNodeIds(new Set([node.id]))
      setLastClickedId(node.id)
    }
  }

  function toggleExpanded(id: number) {
    setExpanded(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }

  // ── Actions ──────────────────────────────────────────────────────────────────

  async function handleCreate() {
    if (selectedNodeIds.size !== 1) return
    const [parentId] = selectedNodeIds
    const name = window.prompt('New node name:')
    if (!name?.trim()) return
    await fetch('/api/lore_nodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent_id: parentId, name: name.trim() }),
    })
    fetchTree()
  }

  async function handleRename() {
    if (selectedNodeIds.size !== 1) return
    const [nodeId] = selectedNodeIds
    const node = findNode(nodeId, tree)
    if (!node) return
    const newName = window.prompt('Rename:', node.name)
    if (!newName?.trim() || newName.trim() === node.name) return
    await fetch(`/api/lore_nodes/${nodeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    })
    fetchTree()
  }

  async function handleDuplicate() {
    if (selectedNodeIds.size !== 1) return
    const [nodeId] = selectedNodeIds
    await fetch(`/api/lore_nodes/${nodeId}/duplicate`, { method: 'POST' })
    fetchTree()
  }

  function handleImport() { fileInputRef.current?.click() }

  async function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f || selectedNodeIds.size !== 1) return
    const [parentId] = selectedNodeIds
    const fd = new FormData()
    fd.append('file', f)
    fd.append('parent_id', String(parentId))
    await fetch('/api/lore_nodes/import', { method: 'POST', body: fd })
    fetchTree()
  }

  async function handleExport() {
    for (const nodeId of selectedNodeIds) {
      const node = findNode(nodeId, tree)
      if (!node) continue
      const version = await fetch(`/api/lore_nodes/${nodeId}/latest`).then(r => r.json())
      if (!version?.content) continue
      const blob = new Blob([version.content], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `${node.name}.txt`; a.click()
      URL.revokeObjectURL(url)
    }
  }

  async function handleSortChildren() {
    await Promise.all(
      [...selectedNodeIds].map(id =>
        fetch(`/api/lore_nodes/${id}/sort-children`, { method: 'POST' })
      )
    )
    fetchTree()
  }

  async function handleDelete() {
    const toDelete = [...selectedNodeIds].filter(id => findNode(id, tree)?.parent_id !== null)
    if (toDelete.length === 0) return
    if (!window.confirm(`Delete ${toDelete.length} node${toDelete.length > 1 ? 's' : ''}?`)) return
    await Promise.all(toDelete.map(id => fetch(`/api/lore_nodes/${id}`, { method: 'DELETE' })))
    setSelectedNodeIds(new Set())
    fetchTree()
  }

  async function handleSyncLore() {
    window.alert('AI Engine sync is not yet implemented.\n\nThis will upload all lore to the selected AI Engine and remove items marked for deletion.')
  }

  // ── Enable/disable conditions ─────────────────────────────────────────────────

  const oneSelected = selectedNodeIds.size === 1
  const anySelected = selectedNodeIds.size >= 1
  const hasContent = anySelected && [...selectedNodeIds].some(id => findNode(id, tree)?.latest_version_status !== null)
  const deletableCount = [...selectedNodeIds].filter(id => findNode(id, tree)?.parent_id !== null).length
  const canDelete = deletableCount > 0
  const onlyRootSelected = anySelected && !canDelete

  // ── Command registry ──────────────────────────────────────────────────────────

  const toolbarItems: ToolbarItem[] = [
    { id: 'create',    label: 'Create child node',  icon: <Plus size={15} />,        enabled: oneSelected,  execute: handleCreate },
    { id: 'duplicate', label: 'Duplicate',           icon: <CopyPlus size={15} />,    enabled: oneSelected && !onlyRootSelected, execute: handleDuplicate },
    { id: 'rename',    label: 'Rename',              icon: <Pencil size={15} />,      enabled: oneSelected, shortcut: 'F2', execute: handleRename },
    { id: 'sort-asc',  label: 'Sort children A→Z',  icon: <ArrowUpAZ size={15} />,   enabled: anySelected,  execute: handleSortChildren },
    'separator',
    { id: 'import', label: 'Import file as child', icon: <Upload size={15} />,   enabled: oneSelected, execute: handleImport },
    { id: 'export', label: 'Export selected',      icon: <Download size={15} />, enabled: hasContent,  execute: handleExport },
    'separator',
    {
      id: 'delete',
      label: onlyRootSelected ? 'Root node cannot be deleted' : 'Delete selected',
      icon: <Trash2 size={15} />,
      shortcut: 'Delete',
      enabled: canDelete,
      variant: 'destructive',
      execute: handleDelete,
    },
    'spacer',
    { id: 'sync-ai', label: 'Sync lore with AI Engine', icon: <CloudUpload size={15} />, enabled: true, variant: 'primary', execute: handleSyncLore },
  ]

  const commandsRef = useRef<LoreCommand[]>([])
  commandsRef.current = toolbarItems.filter((item): item is LoreCommand =>
    typeof item === 'object' && 'id' in item && !!item.shortcut
  )

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const cmd = commandsRef.current.find(c => c.shortcut === e.key && c.enabled)
      if (cmd) { e.preventDefault(); void cmd.execute() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // ── Drag-and-drop ─────────────────────────────────────────────────────────────

  function handleDragStart(e: React.DragEvent<HTMLLIElement>, node: LoreNode) {
    if (node.parent_id === null) { e.preventDefault(); return } // root is not draggable
    e.dataTransfer.setData('application/x-node-id', String(node.id))
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragOver(e: React.DragEvent<HTMLElement>) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }

  function handleDrop(e: React.DragEvent<HTMLElement>, targetNode: LoreNode) {
    e.preventDefault()
    const data = e.dataTransfer.getData('application/x-node-id')
    if (!data) return
    if (data === String(targetNode.id)) return // drop onto self — ignore
    fetch(`/api/lore_nodes/${data}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent_id: targetNode.id }),
    }).then(() => fetchTree()).catch(console.error)
  }

  // ── Tree rendering ────────────────────────────────────────────────────────────

  function renderNode(node: LoreNode) {
    const hasChildren = (node.children?.length ?? 0) > 0
    const hasVersions = node.latest_version_status !== null
    const isExpanded = expanded.has(node.id)
    const isSelected = selectedNodeIds.has(node.id)
    const isDeleted = node.status === 'TO_BE_DELETED'

    const Icon = node.parent_id === null ? Library : nodeIcon(node)

    return (
      <li key={node.id} draggable={node.parent_id !== null} onDragStart={e => handleDragStart(e, node)} onDragOver={handleDragOver} onDrop={e => handleDrop(e, node)}>
        <div className="flex items-center">
          <button
            className="flex items-center justify-center w-4 h-4 shrink-0 text-muted-foreground hover:text-foreground"
            tabIndex={-1}
            onClick={e => { e.stopPropagation(); hasChildren && toggleExpanded(node.id) }}
          >
            {hasChildren && (isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
          </button>
          <div
            className={`flex items-center gap-1.5 flex-1 cursor-pointer rounded px-1 py-0.5 text-sm select-none ${
              isSelected ? 'bg-primary/15 text-primary' : 'hover:bg-secondary'
            } ${isDeleted ? 'line-through opacity-50' : ''}`}
            onClick={e => handleNodeClick(e, node)}
            title={isDeleted ? 'Pending deletion (sync with AI Engine to remove)' : hasVersions ? 'Has content' : undefined}
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

  // ── Toolbar rendering ─────────────────────────────────────────────────────────

  const btnBase = 'flex items-center justify-center w-7 h-7 rounded hover:bg-secondary transition-colors'
  const btnDisabled = 'opacity-30 cursor-not-allowed pointer-events-none'

  function renderToolbarItem(item: ToolbarItem, i: number) {
    if (item === 'separator') return <div key={`sep-${i}`} className="w-px h-4 bg-border mx-0.5 shrink-0" />
    if (item === 'spacer')    return <div key={`spc-${i}`} className="flex-1" />
    const variantCls =
      item.variant === 'destructive' ? 'text-destructive hover:bg-destructive/10' :
      item.variant === 'primary'     ? 'text-primary hover:bg-primary/10' : ''
    return (
      <button
        key={item.id}
        className={`${btnBase} ${variantCls} ${!item.enabled ? btnDisabled : ''}`}
        title={`${item.label}${item.shortcut ? ` (${item.shortcut})` : ''}`}
        onClick={() => { if (item.enabled) void item.execute() }}
      >
        {item.icon}
      </button>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-0.5 border-b border-border pb-1.5">
        {toolbarItems.map(renderToolbarItem)}
      </div>
      <div className="overflow-auto">
        <ul>{Array.isArray(tree) ? tree.map(renderNode) : null}</ul>
      </div>
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChosen} />
    </div>
  )
}
