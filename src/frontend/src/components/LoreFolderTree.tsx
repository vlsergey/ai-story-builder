import React, { useEffect, useRef, useState } from 'react'
import {
  ControlledTreeEnvironment,
  Tree,
  TreeItem,
  TreeItemIndex,
  DraggingPosition,
  TreeViewState,
  InteractionMode,
} from 'react-complex-tree'
import 'react-complex-tree/lib/style-modern.css'
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

function collectAllIds(nodes: LoreNode[]): number[] {
  const ids: number[] = []
  function walk(list: LoreNode[]) {
    list.forEach(n => { ids.push(n.id); if (n.children?.length) walk(n.children) })
  }
  walk(nodes)
  return ids
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

type ItemData = LoreNode | null

function buildItemsMap(roots: LoreNode[]): Record<TreeItemIndex, TreeItem<ItemData>> {
  const items: Record<TreeItemIndex, TreeItem<ItemData>> = {}
  items['root'] = {
    index: 'root',
    isFolder: true,
    children: roots.map(r => r.id),
    canMove: false,
    canRename: false,
    data: null,
  }
  function walk(nodes: LoreNode[]) {
    for (const n of nodes) {
      items[n.id] = {
        index: n.id,
        isFolder: (n.children?.length ?? 0) > 0,
        children: n.children?.map(c => c.id) ?? [],
        canMove: n.parent_id !== null,
        canRename: false,
        data: n,
      }
      if (n.children?.length) walk(n.children)
    }
  }
  walk(roots)
  return items
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function LoreFolderTree({ onSelectLoreNode }: { onSelectLoreNode: (node: LoreNode) => void }) {
  const [tree, setTree] = useState<LoreNode[]>([])
  const [items, setItems] = useState<Record<TreeItemIndex, TreeItem<ItemData>>>({
    root: { index: 'root', isFolder: true, children: [], canMove: false, data: null },
  })
  const [viewState, setViewState] = useState<TreeViewState>({
    'lore-tree': { expandedItems: [], selectedItems: [] },
  })

  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { fetchTree() }, [])

  function fetchTree() {
    fetch('/api/lore_nodes/tree')
      .then(r => r.json())
      .then((data: LoreNode[]) => {
        if (!Array.isArray(data)) return
        setTree(data)
        setItems(buildItemsMap(data))
        setViewState(prev => ({
          ...prev,
          'lore-tree': {
            ...prev['lore-tree'],
            expandedItems: collectAllIds(data),
          },
        }))
      })
      .catch(() => setTree([]))
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  const selectedNodeIds = new Set<number>(
    ((viewState['lore-tree']?.selectedItems ?? []) as TreeItemIndex[]).map(id => Number(id))
  )

  function handleSelectItems(ids: TreeItemIndex[]) {
    setViewState(prev => ({
      ...prev,
      'lore-tree': { ...prev['lore-tree'], selectedItems: ids },
    }))
    if (ids.length === 1) {
      const node = findNode(Number(ids[0]), tree)
      if (node) onSelectLoreNode(node)
    }
  }

  // ── DnD ───────────────────────────────────────────────────────────────────

  async function handleDrop(droppedItems: TreeItem<ItemData>[], target: DraggingPosition) {
    if (target.targetType === 'root') return

    if (target.targetType === 'item') {
      const newParentId = target.targetItem as number
      for (const item of droppedItems) {
        if (!item.data?.id) continue
        await fetch(`/api/lore_nodes/${item.data.id}/move`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parent_id: newParentId }),
        })
      }
    } else if (target.targetType === 'between-items') {
      const parentKey = target.parentItem
      const newParentId = parentKey === 'root' ? null : Number(parentKey)
      const draggedIds = new Set(
        droppedItems.map(i => i.data?.id).filter((id): id is number => id != null)
      )

      // Build reordered children list:
      // Count non-dragged items appearing before childIndex in the original list
      // to find the correct insertion point after removal.
      const currentChildren = (items[parentKey]?.children ?? []).map(Number)
      let insertAt = 0
      for (let i = 0; i < target.childIndex && i < currentChildren.length; i++) {
        if (!draggedIds.has(currentChildren[i])) insertAt++
      }
      const remaining = currentChildren.filter(id => !draggedIds.has(id))
      remaining.splice(insertAt, 0, ...droppedItems.map(i => i.data!.id))

      // Move to new parent first if parent changed
      for (const item of droppedItems) {
        if (!item.data?.id) continue
        if (item.data.parent_id !== newParentId) {
          await fetch(`/api/lore_nodes/${item.data.id}/move`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parent_id: newParentId }),
          })
        }
      }

      // Reorder siblings
      await fetch('/api/lore_nodes/reorder-children', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ child_ids: remaining }),
      })
    }

    fetchTree()
  }

  // ── Actions ──────────────────────────────────────────────────────────────

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
    setViewState(prev => ({ ...prev, 'lore-tree': { ...prev['lore-tree'], selectedItems: [] } }))
    fetchTree()
  }

  async function handleSyncLore() {
    window.alert('AI Engine sync is not yet implemented.\n\nThis will upload all lore to the selected AI Engine and remove items marked for deletion.')
  }

  // ── Enable/disable ────────────────────────────────────────────────────────

  const oneSelected = selectedNodeIds.size === 1
  const anySelected = selectedNodeIds.size >= 1
  const hasContent = anySelected && [...selectedNodeIds].some(id => findNode(id, tree)?.latest_version_status !== null)
  const deletableCount = [...selectedNodeIds].filter(id => findNode(id, tree)?.parent_id !== null).length
  const canDelete = deletableCount > 0
  const onlyRootSelected = anySelected && !canDelete

  // ── Command registry ──────────────────────────────────────────────────────

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

  // ── Toolbar rendering ─────────────────────────────────────────────────────

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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-0.5 border-b border-border pb-1.5">
        {toolbarItems.map(renderToolbarItem)}
      </div>
      <div className="overflow-auto">
        <ControlledTreeEnvironment<ItemData>
          items={items}
          getItemTitle={item => item.data?.name ?? ''}
          viewState={viewState}
          canDragAndDrop
          canDropOnFolder
          canDropOnNonFolder
          canReorderItems
          canDrag={items => items.every(i => i.canMove !== false)}
          canDropAt={(_items, target) =>
            !(target.targetType === 'between-items' && target.parentItem === 'root')
          }
          defaultInteractionMode={InteractionMode.ClickArrowToExpand}
          onSelectItems={handleSelectItems}
          onExpandItem={(item, treeId) => {
            setViewState(prev => ({
              ...prev,
              [treeId]: {
                ...prev[treeId],
                expandedItems: [...(prev[treeId]?.expandedItems ?? []), item.index],
              },
            }))
          }}
          onCollapseItem={(item, treeId) => {
            setViewState(prev => ({
              ...prev,
              [treeId]: {
                ...prev[treeId],
                expandedItems: (prev[treeId]?.expandedItems ?? []).filter(id => id !== item.index),
              },
            }))
          }}
          onDrop={handleDrop}
          renderItem={({ item, depth, children, title, arrow, context }) => {
            const node = item.data
            if (!node) return <>{children}</>
            const isDeleted = node.status === 'TO_BE_DELETED'
            const hasVersions = node.latest_version_status !== null
            const Icon = node.parent_id === null ? Library : nodeIcon(node)
            return (
              <li
                {...(context.itemContainerWithChildrenProps as React.HTMLAttributes<HTMLLIElement>)}
                className="list-none"
              >
                <div
                  {...(context.itemContainerWithoutChildrenProps as React.HTMLAttributes<HTMLDivElement>)}
                  style={{ paddingLeft: `${depth * 16}px` }}
                  className="flex"
                >
                  <div
                    {...(context.interactiveElementProps as React.HTMLAttributes<HTMLDivElement>)}
                    className={[
                      'flex items-center gap-1 flex-1 cursor-pointer rounded px-1 py-0.5 text-sm select-none',
                      context.isSelected ? 'bg-primary/15 text-primary' :
                      context.isDraggingOver ? 'ring-1 ring-primary bg-primary/5' : 'hover:bg-secondary',
                      isDeleted ? 'line-through opacity-50' : '',
                    ].join(' ')}
                    title={
                      isDeleted ? 'Pending deletion (sync with AI Engine to remove)' :
                      hasVersions ? 'Has content' : undefined
                    }
                  >
                    {arrow}
                    <Icon size={14} className="shrink-0 text-muted-foreground" />
                    {title}
                  </div>
                </div>
                {children}
              </li>
            )
          }}
          renderItemArrow={({ item, context }) => (
            <button
              className="flex items-center justify-center w-4 h-4 shrink-0 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
              {...(context.arrowProps as React.HTMLAttributes<HTMLButtonElement>)}
            >
              {item.isFolder && (context.isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
            </button>
          )}
          renderItemTitle={({ title }) => <span>{title}</span>}
          renderItemsContainer={({ children, containerProps }) => (
            <ul
              {...(containerProps as React.HTMLAttributes<HTMLUListElement>)}
              className="pl-0 m-0"
            >
              {children}
            </ul>
          )}
          renderTreeContainer={({ children, containerProps }) => (
            <div {...(containerProps as React.HTMLAttributes<HTMLDivElement>)}>
              {children}
            </div>
          )}
          renderDragBetweenLine={({ draggingPosition, lineProps }) => (
            <div
              {...(lineProps as React.HTMLAttributes<HTMLDivElement>)}
              style={{ left: `${draggingPosition.depth * 16}px`, right: 0 }}
              className="absolute h-0.5 bg-primary z-50 pointer-events-none rounded-full"
            />
          )}
        >
          <Tree treeId="lore-tree" rootItem="root" treeLabel="Lore" />
        </ControlledTreeEnvironment>
      </div>
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChosen} />
    </div>
  )
}
