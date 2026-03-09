import React, { useEffect, useRef, useState } from 'react'
import {
  ControlledTreeEnvironment,
  Tree,
  TreeItem,
  TreeItemIndex,
  TreeRef,
  DraggingPosition,
  TreeViewState,
  InteractionMode,
} from 'react-complex-tree'
import 'react-complex-tree/lib/style-modern.css'
import {
  ChevronRight, ChevronDown,
  Layers, FileText,
  Plus, Pencil, SquarePen, Trash2, Network,
} from 'lucide-react'
import { PlanNodeTree } from '../types/models'
import { PLAN_NODE_SAVED_EVENT, PLAN_TREE_REFRESH_EVENT, PlanNodeSavedDetail } from '../lib/plan-events'
import { ipcClient } from '../ipcClient'

// ── Stats helpers ─────────────────────────────────────────────────────────────

type PlanStatMode = 'none' | 'words' | 'chars' | 'bytes'

function subtreeStat(node: PlanNodeTree, mode: PlanStatMode): number {
  const own = (mode === 'words' ? node.word_count : mode === 'chars' ? node.char_count : node.byte_count) ?? 0
  return own + (node.children ?? []).reduce((sum, c) => sum + subtreeStat(c, mode), 0)
}

function formatStat(count: number, mode: PlanStatMode): string {
  if (count === 0) return ''
  if (mode === 'words') return `${count}w`
  if (mode === 'chars') return `${count}c`
  if (count < 1000) return `${count}B`
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}kB`
  return `${(count / 1_000_000).toFixed(1)}MB`
}

// ── Tree helpers ──────────────────────────────────────────────────────────────

function collectAllIds(nodes: PlanNodeTree[]): number[] {
  const ids: number[] = []
  function walk(list: PlanNodeTree[]) {
    list.forEach(n => { ids.push(n.id); if (n.children?.length) walk(n.children) })
  }
  walk(nodes)
  return ids
}

function findNode(id: number, nodes: PlanNodeTree[]): PlanNodeTree | null {
  for (const n of nodes) {
    if (n.id === id) return n
    if (n.children?.length) { const f = findNode(id, n.children); if (f) return f }
  }
  return null
}

type ItemData = PlanNodeTree | null

function buildItemsMap(roots: PlanNodeTree[]): Record<TreeItemIndex, TreeItem<ItemData>> {
  const items: Record<TreeItemIndex, TreeItem<ItemData>> = {}
  items['root'] = {
    index: 'root',
    isFolder: true,
    children: roots.map(r => r.id),
    canMove: false,
    canRename: false,
    data: null,
  }
  function walk(nodes: PlanNodeTree[]) {
    for (const n of nodes) {
      items[n.id] = {
        index: n.id,
        isFolder: (n.children?.length ?? 0) > 0,
        children: n.children?.map(c => c.id) ?? [],
        canMove: n.parent_id !== null,
        canRename: true,
        data: n,
      }
      if (n.children?.length) walk(n.children)
    }
  }
  walk(roots)
  return items
}

function uniqueTitle(base: string, existingTitles: string[]): string {
  if (!existingTitles.includes(base)) return base
  let n = 2
  while (existingTitles.includes(`${base} ${n}`)) n++
  return `${base} ${n}`
}

function patchNode(
  nodes: PlanNodeTree[], id: number, patch: Partial<Pick<PlanNodeTree, 'title' | 'word_count' | 'char_count' | 'byte_count'>>
): PlanNodeTree[] {
  return nodes.map(n => {
    if (n.id === id) return { ...n, ...patch }
    if (n.children?.length) return { ...n, children: patchNode(n.children, id, patch) }
    return n
  })
}

// ── Command system ────────────────────────────────────────────────────────────

interface PlanCommand {
  id: string
  label: string
  icon: React.ReactElement
  shortcut?: string
  enabled: boolean
  variant?: 'default' | 'destructive' | 'primary'
  execute: () => void | Promise<void>
}

type ToolbarItem = PlanCommand | 'separator' | 'spacer'

// ── Component ─────────────────────────────────────────────────────────────────

export default function PlanTree({
  onOpenEditor,
  onOpenChildrenEditor,
}: {
  onOpenEditor?: (nodeId: number) => void
  onOpenChildrenEditor?: (nodeId: number) => void
}) {
  const [statMode, setStatMode] = useState<PlanStatMode>('none')
  const [tree, setTree] = useState<PlanNodeTree[]>([])
  const [items, setItems] = useState<Record<TreeItemIndex, TreeItem<ItemData>>>({
    root: { index: 'root', isFolder: true, children: [], canMove: false, data: null },
  })
  const [viewState, setViewState] = useState<TreeViewState>({
    'plan-tree': { expandedItems: [], selectedItems: [] },
  })
  const [pendingRenameId, setPendingRenameId] = useState<number | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const treeRef = useRef<TreeRef<ItemData>>(null)
  const treeDataRef = useRef<PlanNodeTree[]>(tree)
  const isFirstLoad = useRef(true)

  useEffect(() => { treeDataRef.current = tree }, [tree])
  useEffect(() => { fetchTree() }, [])

  // Update stats locally when PlanEditor saves content
  useEffect(() => {
    function onNodeSaved(e: Event) {
      const { id, title, wordCount, charCount, byteCount } = (e as CustomEvent<PlanNodeSavedDetail>).detail
      const patch: Partial<Pick<PlanNodeTree, 'title' | 'word_count' | 'char_count' | 'byte_count'>> = {}
      if (title !== undefined) patch.title = title
      if (wordCount !== undefined) patch.word_count = wordCount
      if (charCount !== undefined) patch.char_count = charCount
      if (byteCount !== undefined) patch.byte_count = byteCount
      const next = patchNode(treeDataRef.current, id, patch)
      setTree(next)
      setItems(buildItemsMap(next))
    }
    window.addEventListener(PLAN_NODE_SAVED_EVENT, onNodeSaved)
    return () => window.removeEventListener(PLAN_NODE_SAVED_EVENT, onNodeSaved)
  }, [])

  // Re-fetch full tree on refresh event
  useEffect(() => {
    window.addEventListener(PLAN_TREE_REFRESH_EVENT, fetchTree)
    return () => window.removeEventListener(PLAN_TREE_REFRESH_EVENT, fetchTree)
  }, [])

  // Start rename once item appears in tree
  useEffect(() => {
    if (pendingRenameId === null || !items[pendingRenameId]) return
    setViewState(prev => ({
      ...prev,
      'plan-tree': {
        ...prev['plan-tree'],
        selectedItems: [pendingRenameId],
        focusedItem: pendingRenameId,
      },
    }))
    treeRef.current?.startRenamingItem(pendingRenameId)
    setPendingRenameId(null)
  }, [pendingRenameId, items])

  function fetchTree() {
    ipcClient.plan.nodes()
      .then((data: PlanNodeTree[]) => {
        if (!Array.isArray(data)) return
        setTree(data)
        setItems(buildItemsMap(data))
        if (isFirstLoad.current) {
          isFirstLoad.current = false
          setViewState(prev => ({
            ...prev,
            'plan-tree': {
              ...prev['plan-tree'],
              expandedItems: collectAllIds(data),
            },
          }))
        }
      })
      .catch(() => setTree([]))
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  const selectedNodeIds = new Set<number>(
    ((viewState['plan-tree']?.selectedItems ?? []) as TreeItemIndex[]).map(id => Number(id))
  )

  function handleSelectItems(ids: TreeItemIndex[]) {
    setViewState(prev => ({
      ...prev,
      'plan-tree': {
        ...prev['plan-tree'],
        selectedItems: ids,
        focusedItem: ids.length === 1 ? ids[0] : prev['plan-tree']?.focusedItem,
      },
    }))
  }

  function handleFocusItem(item: TreeItem<ItemData>, treeId: string) {
    setViewState(prev => ({
      ...prev,
      [treeId]: { ...prev[treeId], focusedItem: item.index },
    }))
  }

  // ── DnD ───────────────────────────────────────────────────────────────────

  async function handleDrop(droppedItems: TreeItem<ItemData>[], target: DraggingPosition) {
    if (target.targetType === 'root') return

    if (target.targetType === 'item') {
      const newParentId = target.targetItem as number
      for (const item of droppedItems) {
        if (!item.data?.id) continue
        await ipcClient.plan.moveNode(item.data.id, { parent_id: newParentId })
      }
    } else if (target.targetType === 'between-items') {
      const parentKey = target.parentItem
      const newParentId = parentKey === 'root' ? null : Number(parentKey)
      const draggedIds = new Set(
        droppedItems.map(i => i.data?.id).filter((id): id is number => id != null)
      )
      const currentChildren = (items[parentKey]?.children ?? []).map(Number)
      let insertAt = 0
      for (let i = 0; i < target.childIndex && i < currentChildren.length; i++) {
        if (!draggedIds.has(currentChildren[i])) insertAt++
      }
      const remaining = currentChildren.filter(id => !draggedIds.has(id))
      remaining.splice(insertAt, 0, ...droppedItems.map(i => i.data!.id))

      for (const item of droppedItems) {
        if (!item.data?.id) continue
        if (item.data.parent_id !== newParentId) {
          await ipcClient.plan.moveNode(item.data.id, { parent_id: newParentId })
        }
      }
      await ipcClient.plan.reorderChildren(remaining)
    }
    fetchTree()
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleCreate() {
    if (selectedNodeIds.size !== 1) return
    const [parentId] = selectedNodeIds
    const siblings = findNode(parentId, tree)?.children ?? []
    const title = uniqueTitle('New item', siblings.map(s => s.title))
    const { id: newId } = await ipcClient.plan.createNode({ parent_id: parentId, title })
    fetchTree()
    setPendingRenameId(newId)
  }

  function handleRename() {
    if (selectedNodeIds.size !== 1) return
    const [nodeId] = selectedNodeIds
    treeRef.current?.startRenamingItem(nodeId)
  }

  async function handleInlineRename(item: TreeItem<ItemData>, newTitle: string) {
    if (!item.data?.id || !newTitle.trim() || newTitle.trim() === item.data.title) return
    await ipcClient.plan.patchNode(item.data.id, { title: newTitle.trim() })
    fetchTree()
  }

  function handleEdit() {
    if (selectedNodeIds.size !== 1) return
    const [nodeId] = selectedNodeIds
    onOpenEditor?.(nodeId)
  }

  function handleSplitChildren() {
    if (selectedNodeIds.size !== 1) return
    const [nodeId] = selectedNodeIds
    onOpenChildrenEditor?.(nodeId)
  }

  async function handleDelete() {
    const toDelete = [...selectedNodeIds].filter(id => {
      const n = findNode(id, tree)
      return n?.parent_id !== null
    })
    if (toDelete.length === 0) return
    if (!window.confirm(`Delete ${toDelete.length} node${toDelete.length > 1 ? 's' : ''}? All descendants will also be deleted.`)) return
    await Promise.all(toDelete.map(id => ipcClient.plan.deleteNode(id)))
    setViewState(prev => ({ ...prev, 'plan-tree': { ...prev['plan-tree'], selectedItems: [] } }))
    fetchTree()
  }

  // ── Enable/disable ─────────────────────────────────────────────────────────

  const oneSelected = selectedNodeIds.size === 1
  const canDelete = [...selectedNodeIds].some(id => findNode(id, tree)?.parent_id !== null)
  const onlyRootSelected = selectedNodeIds.size >= 1 && !canDelete

  // ── Commands ──────────────────────────────────────────────────────────────

  const toolbarItems: ToolbarItem[] = [
    { id: 'create',   label: 'Create child node',   icon: <Plus size={15} />,       enabled: oneSelected, execute: handleCreate },
    { id: 'rename',   label: 'Rename (F2)',          icon: <Pencil size={15} />,     enabled: oneSelected, execute: handleRename },
    { id: 'edit',     label: 'Open editor (Enter)', icon: <SquarePen size={15} />,  enabled: oneSelected, execute: handleEdit },
    { id: 'split',    label: 'Split into sub-items', icon: <Network size={15} />,   enabled: oneSelected, variant: 'primary', execute: handleSplitChildren },
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
    // Stat mode toggle
  ]

  const commandsRef = useRef<PlanCommand[]>([])
  commandsRef.current = toolbarItems.filter((item): item is PlanCommand =>
    typeof item === 'object' && 'id' in item && !!item.shortcut
  )

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (containerRef.current && !containerRef.current.contains(target)) return
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      if (e.key === 'Enter') {
        const focusedId = viewState['plan-tree']?.focusedItem
        if (focusedId != null && focusedId !== 'root') {
          e.preventDefault()
          onOpenEditor?.(Number(focusedId))
        }
        return
      }
      if (e.key === 'F2') {
        e.preventDefault()
        handleRename()
        return
      }
      const cmd = commandsRef.current.find(c => c.shortcut === e.key && c.enabled)
      if (cmd) { e.preventDefault(); void cmd.execute() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [viewState, tree, onOpenEditor])

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

  // Stat toggle button
  const statLabels: Record<PlanStatMode, string> = { none: '—', words: 'W', chars: 'C', bytes: 'B' }
  const statModes: PlanStatMode[] = ['none', 'words', 'chars', 'bytes']
  function cycleStatMode() {
    setStatMode(prev => statModes[(statModes.indexOf(prev) + 1) % statModes.length])
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div ref={containerRef} className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-0.5 border-b border-border pb-1.5 shrink-0">
        {toolbarItems.map(renderToolbarItem)}
        <button
          className={`${btnBase} text-xs font-mono text-muted-foreground`}
          title={`Stats: ${statMode}`}
          onClick={cycleStatMode}
        >
          {statLabels[statMode]}
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <ControlledTreeEnvironment<ItemData>
          items={items}
          getItemTitle={item => item.data?.title ?? ''}
          viewState={viewState}
          canDragAndDrop
          canDropOnFolder
          canDropOnNonFolder
          canReorderItems
          canDrag={items => items.every(i => i.canMove !== false)}
          canDropAt={(_, target) => {
            if (target.targetType === 'between-items' && target.parentItem === 'root') return false
            return true
          }}
          defaultInteractionMode={InteractionMode.ClickArrowToExpand}
          onSelectItems={handleSelectItems}
          onFocusItem={handleFocusItem}
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
          canRename
          onRenameItem={handleInlineRename}
          onDrop={handleDrop}
          renderRenameInput={({ inputProps, inputRef, submitButtonProps, submitButtonRef, formProps }) => (
            <form {...formProps} className="flex items-center gap-1 flex-1 min-w-0">
              <input
                {...inputProps}
                ref={inputRef}
                className="flex-1 min-w-0 text-sm bg-background border border-primary rounded px-1 outline-none focus:ring-1 focus:ring-primary"
              />
              <input
                {...submitButtonProps}
                ref={submitButtonRef}
                type="submit"
                value="✓"
                className="text-xs text-primary cursor-pointer hover:text-primary/70"
              />
            </form>
          )}
          renderItem={({ item, depth, children, title, arrow, context }) => {
            const node = item.data
            if (!node) return <>{children}</>
            const hasChildren = (node.children?.length ?? 0) > 0
            const Icon = node.parent_id === null ? Layers : (hasChildren ? Layers : FileText)

            const statText = statMode !== 'none' ? formatStat(subtreeStat(node, statMode), statMode) : ''

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
                    onDoubleClick={() => onOpenEditor?.(node.id)}
                    className={[
                      'flex items-center gap-1 flex-1 min-w-0 cursor-pointer rounded px-1 py-0.5 text-sm select-none overflow-hidden',
                      context.isSelected ? 'bg-primary/15 text-primary' :
                      context.isDraggingOver ? 'ring-1 ring-primary bg-primary/5' : 'hover:bg-secondary',
                    ].join(' ')}
                  >
                    {arrow}
                    <Icon size={14} className="shrink-0 text-muted-foreground" />
                    {title}
                    {statText && (
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums pl-1">{statText}</span>
                    )}
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
          renderItemTitle={({ title }) => <span className="flex-1 min-w-0 truncate">{title}</span>}
          renderItemsContainer={({ children, containerProps }) => (
            <ul {...(containerProps as React.HTMLAttributes<HTMLUListElement>)} className="pl-0 m-0">
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
          <Tree ref={treeRef} treeId="plan-tree" rootItem="root" treeLabel="Plan" />
        </ControlledTreeEnvironment>
      </div>
    </div>
  )
}
