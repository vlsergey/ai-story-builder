import React, { useEffect, useRef, useState, useMemo } from "react"
import {
  ControlledTreeEnvironment,
  Tree,
  TreeItem,
  TreeItemIndex,
  TreeRef,
  DraggingPosition,
  TreeViewState,
  InteractionMode,
} from "react-complex-tree"
import { trpc } from "../ipcClient"
import "react-complex-tree/lib/style-modern.css"
import {
  ChevronRight,
  ChevronDown,
  Library,
  BookOpen,
  ScrollText,
  Plus,
  CopyPlus,
  Pencil,
  SquarePen,
  Upload,
  Download,
  Trash2,
  RotateCcw,
  CloudUpload,
  ArrowUpAZ,
  CheckCircle2,
  Circle,
  Loader2,
  Wand2,
} from "lucide-react"
import { LoreStatMode } from "../types/models"
import type { LoreNodeRow } from "../../../shared/lore-node.js"
import { useLoreSettings } from "../settings/lore-settings"
import { engineSupportsFileUpload } from "../lib/ai-engines"

// ── Command system ────────────────────────────────────────────────────────────

interface LoreCommand {
  id: string
  label: string
  icon: React.ReactElement
  shortcut?: string
  enabled: boolean
  variant?: "default" | "destructive" | "primary"
  execute: () => void | Promise<void>
}

type ToolbarItem = LoreCommand | "separator" | "spacer"

// ── Tree helpers ──────────────────────────────────────────────────────────────

function buildTreeData(nodes: LoreNodeRow[]): {
  roots: number[]
  nodesById: Map<number, LoreNodeRow>
  childrenByParentId: Map<number | null, number[]>
} {
  const nodesById = new Map<number, LoreNodeRow>()
  const childrenByParentId = new Map<number | null, number[]>()

  nodes.forEach((node) => {
    nodesById.set(node.id, node)
    const parentKey = node.parent_id
    if (!childrenByParentId.has(parentKey)) {
      childrenByParentId.set(parentKey, [])
    }
    childrenByParentId.get(parentKey)!.push(node.id)
  })

  const roots = childrenByParentId.get(null) || []
  return { roots, nodesById, childrenByParentId }
}

function collectAllIds(roots: number[], childrenByParentId: Map<number | null, number[]>): number[] {
  const ids: number[] = []
  function walk(parentId: number | null) {
    const children = childrenByParentId.get(parentId) || []
    children.forEach((childId) => {
      ids.push(childId)
      walk(childId)
    })
  }
  walk(null)
  return ids
}

function collectSyncableIds(
  roots: number[],
  nodesById: Map<number, LoreNodeRow>,
  childrenByParentId: Map<number | null, number[]>,
  engine: string,
): Set<number> {
  const ids = new Set<number>()
  function walk(parentId: number | null) {
    const children = childrenByParentId.get(parentId) || []
    children.forEach((childId) => {
      const node = nodesById.get(childId)
      if (node && nodeSyncState(node, engine) !== "none") ids.add(childId)
      walk(childId)
    })
  }
  walk(null)
  return ids
}

/**
 * Icon rules (independent of depth/root status):
 *   - No children              → ScrollText  (a single scroll / leaf)
 *   - All children are leaves  → BookOpen    (a book containing scrolls)
 *   - Some children have kids  → Library     (a bookshelf / collection)
 */
function nodeIcon(
  nodeId: number,
  childrenByParentId: Map<number | null, number[]>,
  nodesById: Map<number, LoreNodeRow>,
): typeof Library {
  const children = childrenByParentId.get(nodeId) || []
  if (children.length === 0) return ScrollText
  // Check if all children are leaves (have no children themselves)
  const allLeaves = children.every((childId) => {
    const childChildren = childrenByParentId.get(childId) || []
    return childChildren.length === 0
  })
  return allLeaves ? BookOpen : Library
}

type ItemData = LoreNodeRow | null

function buildItemsMap(
  roots: number[],
  nodesById: Map<number, LoreNodeRow>,
  childrenByParentId: Map<number | null, number[]>,
): Record<TreeItemIndex, TreeItem<ItemData>> {
  const items: Record<TreeItemIndex, TreeItem<ItemData>> = {}
  items.root = {
    index: "root",
    isFolder: true,
    children: roots,
    canMove: false,
    canRename: false,
    data: null,
  }
  function walk(nodeIds: number[]) {
    for (const nodeId of nodeIds) {
      const node = nodesById.get(nodeId)
      if (!node) continue
      const children = childrenByParentId.get(nodeId) || []
      items[nodeId] = {
        index: nodeId,
        isFolder: children.length > 0,
        children,
        canMove: node.parent_id !== null,
        canRename: true,
        data: node,
      }
      if (children.length > 0) walk(children)
    }
  }
  walk(roots)
  return items
}

function uniqueName(base: string, existingNames: string[]): string {
  if (!existingNames.includes(base)) return base
  let n = 2
  while (existingNames.includes(`${base} ${n}`)) n++
  return `${base} ${n}`
}

// ── Stats helpers ──────────────────────────────────────────────────────────────

function subtreeStat(
  nodeId: number,
  nodesById: Map<number, LoreNodeRow>,
  childrenByParentId: Map<number | null, number[]>,
  mode: LoreStatMode,
): number {
  const node = nodesById.get(nodeId)
  if (!node) return 0
  const own = (mode === "words" ? node.word_count : mode === "chars" ? node.char_count : node.byte_count) ?? 0
  const children = childrenByParentId.get(nodeId) || []
  const childSum = children.reduce((sum, childId) => sum + subtreeStat(childId, nodesById, childrenByParentId, mode), 0)
  return own + childSum
}

function formatStat(count: number, mode: LoreStatMode): string {
  if (count === 0) return ""
  if (mode === "words") return `${count}w`
  if (mode === "chars") return `${count}c`
  if (count < 1000) return `${count}B`
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}kB`
  return `${(count / 1_000_000).toFixed(1)}MB`
}

/**
 * Sync state for a single node (ignoring children).
 *
 * Rules:
 *  - to_be_deleted + previously synced  → needs-sync (remote file must be deleted)
 *  - to_be_deleted + never synced       → none       (nothing to do)
 *  - empty (word_count=0) + previously synced → needs-sync (remote file must be cleaned up)
 *  - empty + never synced               → none       (nothing to do)
 *  - non-empty, not yet synced          → needs-sync
 *  - non-empty, synced, content changed since last sync → needs-sync
 *  - non-empty, synced, up-to-date      → synced
 */
function nodeSyncState(node: LoreNodeRow, engine: string): "none" | "needs-sync" | "synced" {
  // TODO: parse ai_sync_info from string to object
  // For now, treat as none
  return "none"
}

/**
 * Aggregate sync state across an entire subtree.
 *   any needs-sync → needs-sync
 *   all none       → none
 *   otherwise      → synced
 */
function subtreeSyncState(
  nodeId: number,
  nodesById: Map<number, LoreNodeRow>,
  childrenByParentId: Map<number | null, number[]>,
  engine: string,
): "none" | "needs-sync" | "synced" {
  const node = nodesById.get(nodeId)
  if (!node) return "none"
  const own = nodeSyncState(node, engine)
  const children = childrenByParentId.get(nodeId) || []
  const childStates = children.map((childId) => subtreeSyncState(childId, nodesById, childrenByParentId, engine))
  const all = [own, ...childStates]
  if (all.some((s) => s === "needs-sync")) return "needs-sync"
  if (all.every((s) => s === "none")) return "none"
  return "synced"
}

function subtreeIsInProgress(
  nodeId: number,
  childrenByParentId: Map<number | null, number[]>,
  syncingNodeIds: ReadonlySet<number>,
): boolean {
  if (syncingNodeIds.has(nodeId)) return true
  const children = childrenByParentId.get(nodeId) || []
  return children.some((childId) => subtreeIsInProgress(childId, childrenByParentId, syncingNodeIds))
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function LoreTree({
  onSelectLoreNode,
  onOpenLoreNode,
  onOpenLoreWizard,
  syncingNodeIds,
}: {
  onSelectLoreNode: (node: LoreNodeRow) => void
  onOpenLoreNode?: (node: LoreNodeRow) => void
  onOpenLoreWizard?: (node: LoreNodeRow) => void
  syncingNodeIds?: ReadonlySet<number>
}) {
  const { statMode } = useLoreSettings()
  const utils = trpc.useUtils()

  const treeQuery = trpc.lore.findAll.useQuery()
  const { roots, nodesById, childrenByParentId } = useMemo(() => buildTreeData(treeQuery.data || []), [treeQuery.data])

  const [syncingIds, setSyncingIds] = useState<Set<number>>(new Set())
  const [items, setItems] = useState<Record<TreeItemIndex, TreeItem<ItemData>>>({
    root: { index: "root", isFolder: true, children: [], canMove: false, data: null },
  })
  const [viewState, setViewState] = useState<TreeViewState>({
    "lore-tree": { expandedItems: [], selectedItems: [] },
  })

  const [pendingRenameId, setPendingRenameId] = useState<number | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const treeRef = useRef<TreeRef<ItemData>>(null)
  // Expand all nodes only on the very first load; subsequent fetches preserve user's collapse state.
  const isFirstLoad = useRef(true)

  // Once the pending-rename item appears in `items`, select it and start rename
  useEffect(() => {
    if (pendingRenameId === null || !items[pendingRenameId]) return
    setViewState((prev) => ({
      ...prev,
      "lore-tree": {
        ...prev["lore-tree"],
        selectedItems: [pendingRenameId],
        focusedItem: pendingRenameId,
      },
    }))
    treeRef.current?.startRenamingItem(pendingRenameId)
    const id = pendingRenameId
    setTimeout(() => {
      containerRef.current
        ?.querySelector(`[data-rct-item-id="${id}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" })
    }, 0)
    setPendingRenameId(null)
  }, [pendingRenameId, items])

  useEffect(() => {
    const { roots, nodesById, childrenByParentId } = buildTreeData(treeQuery.data || [])
    setItems(buildItemsMap(roots, nodesById, childrenByParentId))
    if (isFirstLoad.current) {
      isFirstLoad.current = false
      setViewState((prev) => ({
        ...prev,
        "lore-tree": {
          ...prev["lore-tree"],
          expandedItems: collectAllIds(roots, childrenByParentId),
        },
      }))
    }
  }, [treeQuery.data])

  // ── Selection ─────────────────────────────────────────────────────────────

  const selectedNodeIds = new Set<number>((viewState["lore-tree"]?.selectedItems ?? []).map((id) => Number(id)))

  function handleSelectItems(ids: TreeItemIndex[]) {
    setViewState((prev) => ({
      ...prev,
      "lore-tree": {
        ...prev["lore-tree"],
        selectedItems: ids,
        // Keep focus in sync with selection so F2 renames the right item
        focusedItem: ids.length === 1 ? ids[0] : prev["lore-tree"]?.focusedItem,
      },
    }))
    if (ids.length === 1) {
      const node = nodesById.get(Number(ids[0]))
      if (node) onSelectLoreNode(node)
    }
  }

  function handleFocusItem(item: TreeItem<ItemData>, treeId: string) {
    setViewState((prev) => ({
      ...prev,
      [treeId]: { ...prev[treeId], focusedItem: item.index },
    }))
  }

  // ── DnD ───────────────────────────────────────────────────────────────────

  const loreMove = trpc.lore.move.useMutation()
  const loreReorderChildren = trpc.lore.reorderChildren.useMutation()

  async function handleDrop(droppedItems: TreeItem<ItemData>[], target: DraggingPosition) {
    if (target.targetType === "root") return

    if (target.targetType === "item") {
      const newParentId = target.targetItem as number
      for (const item of droppedItems) {
        if (!item.data?.id) continue
        await loreMove.mutateAsync({ id: item.data.id, parent_id: newParentId })
      }
    } else if (target.targetType === "between-items") {
      const parentKey = target.parentItem
      const newParentId = parentKey === "root" ? null : Number(parentKey)
      const draggedIds = new Set(droppedItems.map((i) => i.data?.id).filter((id): id is number => id != null))

      // Build reordered children list:
      // Count non-dragged items appearing before childIndex in the original list
      // to find the correct insertion point after removal.
      const currentChildren = (items[parentKey]?.children ?? []).map(Number)
      let insertAt = 0
      for (let i = 0; i < target.childIndex && i < currentChildren.length; i++) {
        if (!draggedIds.has(currentChildren[i])) insertAt++
      }
      const remaining = currentChildren.filter((id) => !draggedIds.has(id))
      remaining.splice(insertAt, 0, ...droppedItems.map((i) => i.data!.id))

      // Move to new parent first if parent changed
      for (const item of droppedItems) {
        if (!item.data?.id) continue
        if (item.data.parent_id !== newParentId) {
          await loreMove.mutateAsync({ id: item.data.id, parent_id: newParentId })
        }
      }

      // Reorder siblings
      await loreReorderChildren.mutateAsync(remaining)
    }

    await utils.lore.findAll.invalidate()
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  const loreCreate = trpc.lore.create.useMutation()

  async function handleCreate() {
    if (selectedNodeIds.size !== 1) return
    const [parentId] = selectedNodeIds
    const siblingIds = childrenByParentId.get(parentId) ?? []
    const siblingTitles = siblingIds.map((id) => nodesById.get(id)?.title).filter((t): t is string => !!t)
    const name = uniqueName("New node", siblingTitles)
    const { id: newId } = await loreCreate.mutateAsync({ parent_id: parentId, name })
    setPendingRenameId(newId)
    await utils.lore.findAll.invalidate()
  }

  function handleRename() {
    if (selectedNodeIds.size !== 1) return
    const [nodeId] = selectedNodeIds
    treeRef.current?.startRenamingItem(nodeId)
  }

  const lorePatch = trpc.lore.patch.useMutation()

  async function handleInlineRename(item: TreeItem<ItemData>, newName: string) {
    if (!item.data?.id || !newName.trim() || newName.trim() === item.data.title) return
    await lorePatch.mutateAsync({ id: item.data.id, data: { name: newName.trim() } })
    await utils.lore.findAll.invalidate()
  }

  const loreDuplicate = trpc.lore.duplicate.useMutation()

  async function handleDuplicate() {
    if (selectedNodeIds.size !== 1) return
    const [nodeId] = selectedNodeIds
    await loreDuplicate.mutateAsync(nodeId)
    await utils.lore.findAll.invalidate()
  }

  function handleImport() {
    fileInputRef.current?.click()
  }

  const loreImport = trpc.lore.import.useMutation()

  async function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ""
    if (!f || selectedNodeIds.size !== 1) return
    const [parentId] = selectedNodeIds
    // Read file content as text
    const content = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (ev) => resolve(ev.target!.result as string)
      reader.onerror = reject
      reader.readAsText(f)
    })
    await loreImport.mutateAsync({ title: f.name, content, parentId: Number(parentId) })
    await utils.lore.findAll.invalidate()
  }

  async function handleExport() {
    for (const nodeId of selectedNodeIds) {
      const node = nodesById.get(nodeId)
      if (!node?.content?.trim()) continue
      const blob = new Blob([node.content], { type: "text/plain" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${node.title}.txt`
      a.click()
      URL.revokeObjectURL(url)
    }
  }

  const loreSortChildren = trpc.lore.sortChildren.useMutation()

  async function handleSortChildren() {
    await Promise.all(
      [...selectedNodeIds]
        .filter((id) => (childrenByParentId.get(id)?.length ?? 0) > 1)
        .map((id) => loreSortChildren.mutateAsync(id)),
    )
    await utils.lore.findAll.invalidate()
  }

  const loreDelete = trpc.lore.delete.useMutation()

  async function handleDelete() {
    const toDelete = [...selectedNodeIds].filter((id) => {
      const n = nodesById.get(id)
      return n?.parent_id !== null && !n?.to_be_deleted
    })
    if (toDelete.length === 0) return
    const message = `Mark ${toDelete.length} node${toDelete.length > 1 ? "s" : ""} for deletion? All descendants will also be marked.`
    const confirmed = window.electronAPI.confirm(message)
    if (!confirmed) return
    await Promise.all(toDelete.map((id) => loreDelete.mutateAsync(id)))
    setViewState((prev) => ({ ...prev, "lore-tree": { ...prev["lore-tree"], selectedItems: [] } }))
    await utils.lore.findAll.invalidate()
  }

  const loreRestore = trpc.lore.restore.useMutation()

  async function handleRestore() {
    const toRestore = [...selectedNodeIds].filter((id) => nodesById.get(id)?.to_be_deleted)
    await Promise.all(toRestore.map((id) => loreRestore.mutateAsync(id)))
    await utils.lore.findAll.invalidate()
  }

  function handleOpen() {
    if (selectedNodeIds.size !== 1) return
    const [nodeId] = selectedNodeIds
    const node = nodesById.get(nodeId)
    if (node) onOpenLoreNode?.(node)
  }

  function handleOpenWizard() {
    if (selectedNodeIds.size !== 1) return
    const [nodeId] = selectedNodeIds
    const node = nodesById.get(nodeId)
    if (node) onOpenLoreWizard?.(node)
  }

  function showError(message: string) {
    void window.electronAPI.showErrorDialog("Sync Error", message)
  }

  const currentAiEngine = trpc.settings.allAiEnginesConfig.currentEngine.get.useQuery().data || null

  const aiSyncLore = trpc.ai.syncLore.useMutation()

  async function handleSyncLore() {
    if (!currentAiEngine) return
    const toSync = collectSyncableIds(roots, nodesById, childrenByParentId, currentAiEngine)
    setSyncingIds(toSync.size > 0 ? toSync : new Set(collectAllIds(roots, childrenByParentId).map((id) => id)))
    try {
      const data = await aiSyncLore.mutateAsync()
      if (!data.ok) {
        showError(`Sync failed: unknown error`)
      }
    } catch (e) {
      showError(`Sync error: ${String(e)}`)
    } finally {
      setSyncingIds(new Set())
      await utils.lore.findAll.invalidate()
    }
  }

  // ── Enable/disable ────────────────────────────────────────────────────────

  const treeSyncNeeded =
    currentAiEngine != null &&
    engineSupportsFileUpload(currentAiEngine) &&
    Array.from(nodesById.keys()).some(
      (nodeId) => subtreeSyncState(nodeId, nodesById, childrenByParentId, currentAiEngine) === "needs-sync",
    )

  const oneSelected = selectedNodeIds.size === 1
  const anySelected = selectedNodeIds.size >= 1
  const canSort = [...selectedNodeIds].some((id) => (childrenByParentId.get(id)?.length ?? 0) > 1)
  const hasContent =
    anySelected &&
    [...selectedNodeIds].some((id) => {
      const n = nodesById.get(id)
      return !!n?.content?.trim()
    })
  const deletableCount = [...selectedNodeIds].filter((id) => {
    const n = nodesById.get(id)
    return n?.parent_id !== null && !n?.to_be_deleted
  }).length
  const canDelete = deletableCount > 0
  const onlyRootSelected = anySelected && !canDelete
  // All selected nodes are marked for deletion → show Restore instead of Delete
  const allSelectedToBeDeleted = anySelected && [...selectedNodeIds].every((id) => nodesById.get(id)?.to_be_deleted)

  // ── Command registry ──────────────────────────────────────────────────────

  const toolbarItems: ToolbarItem[] = [
    {
      id: "wizard",
      label: currentAiEngine ? "Create with AI" : "Create with AI (no engine configured)",
      icon: <Wand2 size={15} />,
      enabled: oneSelected && currentAiEngine != null,
      variant: "primary",
      execute: handleOpenWizard,
    },
    "separator",
    { id: "create", label: "Create child node", icon: <Plus size={15} />, enabled: oneSelected, execute: handleCreate },
    {
      id: "duplicate",
      label: "Duplicate",
      icon: <CopyPlus size={15} />,
      enabled: oneSelected && !onlyRootSelected,
      execute: handleDuplicate,
    },
    { id: "rename", label: "Rename (F2)", icon: <Pencil size={15} />, enabled: oneSelected, execute: handleRename },
    {
      id: "edit",
      label: "Open editor (Enter)",
      icon: <SquarePen size={15} />,
      enabled: oneSelected,
      execute: handleOpen,
    },
    {
      id: "sort-asc",
      label: "Sort children A→Z",
      icon: <ArrowUpAZ size={15} />,
      enabled: canSort,
      execute: handleSortChildren,
    },
    "separator",
    {
      id: "import",
      label: "Import file as child",
      icon: <Download size={15} />,
      enabled: oneSelected,
      execute: handleImport,
    },
    { id: "export", label: "Export selected", icon: <Upload size={15} />, enabled: hasContent, execute: handleExport },
    "separator",
    allSelectedToBeDeleted
      ? {
          id: "restore",
          label: "Restore selected",
          icon: <RotateCcw size={15} />,
          enabled: true,
          execute: handleRestore,
        }
      : {
          id: "delete",
          label: onlyRootSelected ? "Root node cannot be deleted" : "Delete selected",
          icon: <Trash2 size={15} />,
          shortcut: "Delete",
          enabled: canDelete,
          variant: "destructive" as const,
          execute: handleDelete,
        },
    "spacer",
    {
      id: "sync-ai",
      label: !engineSupportsFileUpload(currentAiEngine)
        ? "Sync lore with AI Engine (engine does not support file upload)"
        : !treeSyncNeeded
          ? "Sync lore with AI Engine (all nodes already synced)"
          : "Sync lore with AI Engine",
      icon: <CloudUpload size={15} />,
      enabled: treeSyncNeeded,
      variant: "primary",
      execute: handleSyncLore,
    },
  ]

  const commandsRef = useRef<LoreCommand[]>([])
  commandsRef.current = toolbarItems.filter(
    (item): item is LoreCommand => typeof item === "object" && "id" in item && !!item.shortcut,
  )

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      // Only handle keyboard shortcuts when focus is within the lore tree panel
      if (containerRef.current && !containerRef.current.contains(target)) return
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return
      if (e.key === "Enter") {
        const focusedId = viewState["lore-tree"]?.focusedItem
        if (focusedId != null && focusedId !== "root") {
          const node = nodesById.get(Number(focusedId))
          if (node) {
            e.preventDefault()
            onOpenLoreNode?.(node)
          }
        }
        return
      }
      const cmd = commandsRef.current.find((c) => c.shortcut === e.key && c.enabled)
      if (cmd) {
        e.preventDefault()
        void cmd.execute()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [nodesById, viewState, onOpenLoreNode])

  // ── Toolbar rendering ─────────────────────────────────────────────────────

  const btnBase = "flex items-center justify-center w-7 h-7 rounded hover:bg-secondary transition-colors"
  const btnDisabled = "opacity-30 cursor-not-allowed pointer-events-none"

  function renderToolbarItem(item: ToolbarItem, i: number) {
    if (item === "separator") return <div key={`sep-${i}`} className="w-px h-4 bg-border mx-0.5 shrink-0" />
    if (item === "spacer") return <div key={`spc-${i}`} className="flex-1" />
    const variantCls =
      item.variant === "destructive"
        ? "text-destructive hover:bg-destructive/10"
        : item.variant === "primary"
          ? "text-primary hover:bg-primary/10"
          : ""
    return (
      <button
        key={item.id}
        className={`${btnBase} ${variantCls} ${!item.enabled ? btnDisabled : ""}`}
        title={`${item.label}${item.shortcut ? ` (${item.shortcut})` : ""}`}
        onClick={() => {
          if (item.enabled) void item.execute()
        }}
      >
        {item.icon}
      </button>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div ref={containerRef} className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-0.5 border-b border-border pb-1.5 shrink-0">
        {toolbarItems.map(renderToolbarItem)}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <ControlledTreeEnvironment<ItemData>
          items={items}
          getItemTitle={(item) => item.data?.title ?? ""}
          viewState={viewState}
          canDragAndDrop
          canDropOnFolder
          canDropOnNonFolder
          canReorderItems
          canDrag={(items) => items.every((i) => i.canMove !== false)}
          canDropAt={(droppedItems, target) => {
            if (target.targetType === "between-items" && target.parentItem === "root") return false
            // Cannot drop active nodes into a to_be_deleted parent
            const parentKey =
              target.targetType === "item"
                ? target.targetItem
                : target.targetType === "between-items"
                  ? target.parentItem
                  : null
            if (parentKey) {
              const parentData = items[parentKey]?.data
              if (parentData?.to_be_deleted && droppedItems.some((i) => !i.data?.to_be_deleted)) return false
            }
            return true
          }}
          defaultInteractionMode={InteractionMode.ClickArrowToExpand}
          onSelectItems={handleSelectItems}
          onFocusItem={handleFocusItem}
          onExpandItem={(item, treeId) => {
            setViewState((prev) => ({
              ...prev,
              [treeId]: {
                ...prev[treeId],
                expandedItems: [...(prev[treeId]?.expandedItems ?? []), item.index],
              },
            }))
          }}
          onCollapseItem={(item, treeId) => {
            setViewState((prev) => ({
              ...prev,
              [treeId]: {
                ...prev[treeId],
                expandedItems: (prev[treeId]?.expandedItems ?? []).filter((id) => id !== item.index),
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
            const isDeleted = !!node.to_be_deleted
            const hasVersions = !!node.content?.trim()
            const Icon = node.parent_id === null ? Library : nodeIcon(node.id, childrenByParentId, nodesById)

            const statText =
              statMode !== "none"
                ? formatStat(subtreeStat(node.id, nodesById, childrenByParentId, statMode), statMode)
                : ""
            const syncState = engineSupportsFileUpload(currentAiEngine)
              ? subtreeSyncState(node.id, nodesById, childrenByParentId, currentAiEngine!)
              : "none"
            const effectiveSyncingIds = syncingIds.size > 0 ? syncingIds : (syncingNodeIds ?? new Set<number>())
            const inProgress =
              syncState !== "none" && subtreeIsInProgress(node.id, childrenByParentId, effectiveSyncingIds)
            const showSync = syncState !== "none"
            const synced = syncState === "synced"

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
                    onDoubleClick={() => {
                      if (node) onOpenLoreNode?.(node)
                    }}
                    className={[
                      "flex items-center gap-1 flex-1 min-w-0 cursor-pointer rounded px-1 py-0.5 text-sm select-none overflow-hidden",
                      context.isSelected
                        ? "bg-primary/15 text-primary"
                        : context.isDraggingOver
                          ? "ring-1 ring-primary bg-primary/5"
                          : "hover:bg-secondary",
                      isDeleted ? "line-through opacity-50" : "",
                    ].join(" ")}
                    title={
                      isDeleted
                        ? "Pending deletion (sync with AI Engine to remove)"
                        : hasVersions
                          ? "Has content"
                          : undefined
                    }
                  >
                    {arrow}
                    <Icon size={14} className="shrink-0 text-muted-foreground" />
                    {title}
                    {statText && (
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums pl-1">
                        {statText}
                      </span>
                    )}
                    {showSync && inProgress && (
                      <Loader2
                        aria-label="syncing"
                        size={12}
                        className={`shrink-0 text-muted-foreground animate-spin${!statText ? " ml-auto" : ""}`}
                      />
                    )}
                    {showSync && !inProgress && synced && (
                      <CheckCircle2
                        aria-label="synced"
                        size={12}
                        className={`shrink-0 text-green-500${!statText ? " ml-auto" : ""}`}
                      />
                    )}
                    {showSync && !inProgress && !synced && (
                      <Circle
                        aria-label="not synced"
                        size={12}
                        className={`shrink-0 text-muted-foreground${!statText ? " ml-auto" : ""}`}
                      />
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
            <div {...(containerProps as React.HTMLAttributes<HTMLDivElement>)}>{children}</div>
          )}
          renderDragBetweenLine={({ draggingPosition, lineProps }) => (
            <div
              {...(lineProps as React.HTMLAttributes<HTMLDivElement>)}
              style={{ left: `${draggingPosition.depth * 16}px`, right: 0 }}
              className="absolute h-0.5 bg-primary z-50 pointer-events-none rounded-full"
            />
          )}
        >
          <Tree ref={treeRef} treeId="lore-tree" rootItem="root" treeLabel="Lore" />
        </ControlledTreeEnvironment>
      </div>
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChosen} />
    </div>
  )
}
