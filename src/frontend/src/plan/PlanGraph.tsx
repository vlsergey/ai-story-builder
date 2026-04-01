import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type Connection,
  type Viewport,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useLocale } from '../lib/locale'
import { type PlanNodeType, PlanNodeUpdate, type PlanEdgeRow } from '@shared/plan-graph'
import { EDGE_TYPES, canCreateEdge, getCreatableNodeTypes, getNodeTypeDefinition } from '@shared/node-edge-dictionary'
import { applyHierarchicalLayout } from './layout/hierarchical-layout'
import PlanTextNode from './plan-graph/PlanTextNode'
import PlanLoreNode from './plan-graph/PlanLoreNode'
import PlanMergeNode from './plan-graph/PlanMergeNode'
import PlanSplitterNode from './plan-graph/PlanSplitterNode'
import PlanForEachNode from './plan-graph/PlanForEachNode'
import PlanEdgeComponent from './plan-graph/PlanEdge'
import GenerateAllDialog from './GenerateAllDialog'
import { trpc } from '../ipcClient'
import { PlanNodeRow } from '@shared/plan-graph'
import { useDebouncedCallback } from 'use-debounce';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/ui-components/context-menu'
import { sortByHierarchy } from '@/lib/sortByHierarchy'

const nodeTypes = {
  'text': PlanTextNode,
  'lore': PlanLoreNode,
  'merge': PlanMergeNode,
  'split': PlanSplitterNode,
  'for-each': PlanForEachNode,
  'group': PlanForEachNode,
  'for-each-output': PlanTextNode,
  'for-each-input': PlanTextNode,
}

const edgeTypes = {
  planEdge: PlanEdgeComponent,
}

function toReactFlowNodes(graphNodes: PlanNodeRow[], onDelete: (id: number) => void): Node[] {
  const sortedByHierarchy = sortByHierarchy(graphNodes, n => n.id, n => n.parent_id)
  return sortedByHierarchy.map(n => {
    const childCount = graphNodes.filter(child => child.parent_id === n.id).length;
    const nodeDef = getNodeTypeDefinition(n.type);
    const isGroup = nodeDef?.isGroup ?? false;
    const isConfined = nodeDef?.confined ?? false;
    const reactFlowType = isGroup ? 'group' : n.type;
    const extent = isConfined ? 'parent' : undefined;
    return {
      id: String(n.id),
      type: reactFlowType,
      position: { x: n.x ?? 0, y: n.y ?? 0 },
      parentId: n.parent_id ? String(n.parent_id) : undefined,
      data: { ...n, onDelete, childCount },
      width: n.width ?? 200,
      height: n.height ?? 100,
      extent,
    };
  });
}

function toReactFlowEdges(graphEdges: PlanEdgeRow[], onDeleteEdge: (id: number) => void): Edge[] {
  return graphEdges.map(e => ({
    id: String(e.id),
    source: String(e.from_node_id),
    target: String(e.to_node_id),
    type: 'planEdge',
    data: { type: e.type, label: e.label, onDelete: onDeleteEdge },
  }))
}

export default function PlanGraph() {
  const { t } = useLocale()
  const [nodes, setNodes, onNodesChangeImpl] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  const { data: serverNodes, isLoading: areNodesLoading } = trpc.plan.nodes.getAll.useQuery(undefined, {
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    refetchOnMount: true,
    onSuccess: () => { console.log("Reloaded nodes from server") },
  })
  const { data: serverEdges, isLoading: areEdgesLoading } = trpc.plan.edges.getAll.useQuery(undefined, {
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    refetchOnMount: true,
    onSuccess: () => { console.log("Reloaded edges from server") },
  })
  const loading = areNodesLoading || areEdgesLoading
  const deleteEdge = trpc.plan.edges.delete.useMutation().mutate
  const deleteNodeMutation = trpc.plan.nodes.delete.useMutation().mutate
  const aiGenerateSummary = trpc.plan.nodes.aiGenerateSummary.useMutation().mutate

  const deleteNode = useCallback(async (nodeId: number) => {
    const message = t('planGraph.deleteConfirmation')
    const confirmed = window.electronAPI.confirm(message)
    if (!confirmed) return
    deleteNodeMutation(nodeId)
  }, [deleteNodeMutation, t])

  // replace local cache with server data
  useEffect(() => {
    if (serverNodes) setNodes(toReactFlowNodes(serverNodes ?? [], deleteNode))
    if (serverEdges) setEdges(toReactFlowEdges(serverEdges ?? [], deleteEdge))
  }, [serverNodes, serverEdges, deleteEdge, deleteNode, setNodes, setEdges])

  const patchNodes = trpc.plan.nodes.batchPatch.useMutation().mutate

  const debouncedSaveNodes = useDebouncedCallback(() => {
    const toPatch = nodes.map(n => {
      const data: PlanNodeUpdate = excludeDuplicates({
        x: n.position.x,
        y: n.position.y,
        width: n.width,
        height: n.height,
      }, n.data);

      if (Object.keys(data).length > 0) {
        console.log(`[PlanGraph] Patching node ${n.id}`, data);
        return { id: Number(n.id), data };
      }
      return null;
    }).filter(n => n !== null);

    if (toPatch.length > 0) {
      patchNodes(toPatch);
    }
  }, 1000);

  // update
  const onNodesChange = useCallback((nodeChanges: NodeChange[]) => {
    onNodesChangeImpl(nodeChanges)
    debouncedSaveNodes()
  }, [debouncedSaveNodes, onNodesChangeImpl])

  const [autoLayout, setAutoLayout] = useState<boolean>(() => {
    try { return localStorage.getItem('planGraph.autoLayout') !== 'false' }
    catch { return true }
  })
  const [showConnectDialog, setShowConnectDialog] = useState<Connection | null>(null)
  const [showGenerateAll, setShowGenerateAll] = useState(false)
  const [addDialog, setAddDialog] = useState<{ type: PlanNodeType } | null>(null)
  const [addTitle, setAddTitle] = useState('')
  const addTitleInputRef = useRef<HTMLInputElement>(null)
  const reactFlowInstance = useRef<any>(null)
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 })
  const hasFitted = useRef(false)

  // Fit view after nodes are loaded and when layout changes
  useEffect(() => {
    if ((nodes?.length || 0) > 0 && !hasFitted.current && reactFlowInstance.current) {
      reactFlowInstance.current.fitView({ padding: 0.2 })
      hasFitted.current = true
    }
  }, [nodes])

  function openAddDialog(type: PlanNodeType) {
    setAddTitle('')
    setAddDialog({ type })
    // focus the input on next paint
    setTimeout(() => addTitleInputRef.current?.focus(), 0)
  }

  const addNode = trpc.plan.nodes.create.useMutation().mutate

  async function confirmAddNode() {
    if (!addTitle.trim() || !addDialog) return
    const title = addTitle.trim()
    const type = addDialog.type
    setAddDialog(null)
    setAddTitle('')
    const centerX = 100 + Math.random() * 200
    const centerY = 100 + Math.random() * 200
    addNode({ type, title, x: centerX, y: centerY })
  }

  const patchNode = trpc.plan.nodes.patch.useMutation().mutate

  const onNodeDragStop = useCallback((_: React.MouseEvent, node: Node) => {
    if (autoLayout) return

    // Find containing group (nodes with isGroup flag)
    const groups = nodes.filter(n => {
      const def = getNodeTypeDefinition(n.type as PlanNodeType)
      return def?.isGroup === true
    })
    let newParentId: number | null = null
    for (const g of groups) {
      const gWidth = g.width ?? 200
      const gHeight = g.height ?? 100
      const left = g.position.x
      const top = g.position.y
      const right = left + gWidth
      const bottom = top + gHeight
      const nodeX = node.position.x
      const nodeY = node.position.y
      // simple point-in-rect check (node position is i
      // ts top-left corner)
      if (nodeX >= left && nodeX <= right && nodeY >= top && nodeY <= bottom) {
        newParentId = Number(g.id)
        break
      }
    }

    // Validate: cannot be parent of itself
    if (newParentId === Number(node.id)) {
      newParentId = null
    }

    // Determine current parent from server data
    const currentNode = serverNodes?.find(n => n.id === Number(node.id))
    const currentParentId = currentNode?.parent_id ?? null

    // Prepare update data
    const updateData: any = { x: node.position.x, y: node.position.y }
    if (newParentId !== currentParentId) {
      updateData.parent_id = newParentId
    }

    patchNode({ id: Number(node.id), manual: true, data: updateData })
  }, [autoLayout, patchNode, nodes, serverNodes])

  const contextMenuTriggerRef = useRef<HTMLSpanElement>(null)
  const [contextMenuNodeId, setContextMenuNodeId] = useState<number | null>(null)
  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault()
    if (contextMenuTriggerRef.current) {
      setContextMenuNodeId(Number(node.id))
      const fakeEvent = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: event.clientX,
        clientY: event.clientY,
      })
      // Генерируем событие на элементе-триггере
      contextMenuTriggerRef.current.dispatchEvent(fakeEvent)
    }
  }, [contextMenuTriggerRef, setContextMenuNodeId])

  const scheduleLayout = useCallback(() => {
    if (autoLayout) {
      setTimeout(() => reactFlowInstance.current?.fitView({ padding: 0.2 }), 0)
    }
  }, [autoLayout])

  const createEdge = trpc.plan.edges.create.useMutation({
    onSuccess: scheduleLayout
  }).mutate

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) {
      return
    }
    const sourceNode = (nodes || []).find(n => n.id === connection.source)
    const targetNode = (nodes || []).find(n => n.id === connection.target)
    const sourceType = sourceNode?.type as PlanNodeType | undefined
    const targetType = targetNode?.type as PlanNodeType | undefined

    if (!sourceType || !targetType) {
      return
    }

    const allowedEdgeTypes = EDGE_TYPES.filter(edgeDef =>
      canCreateEdge(sourceType, targetType, edgeDef.id)
    ).map(edgeDef => edgeDef.id)

    if (allowedEdgeTypes.length === 0) {
      // No allowed edge types, maybe show error? For now just ignore.
      return
    }

    if (allowedEdgeTypes.length === 1) {
      // Automatically create the edge
      const edgeType = allowedEdgeTypes[0]
      createEdge({
        from_node_id: Number(connection.source),
        to_node_id: Number(connection.target),
        type: edgeType,
      })
      return
    }

    // Multiple allowed edge types, show selection dialog
    setShowConnectDialog(connection)
  }, [nodes, createEdge])


  async function confirmConnect(edgeType: string) {
    if (!showConnectDialog?.source || !showConnectDialog?.target) return
    createEdge({
      from_node_id: Number(showConnectDialog.source),
      to_node_id: Number(showConnectDialog.target),
      type: edgeType,
    })
    scheduleLayout()
    setShowConnectDialog(null)
  }

  function toggleAutoLayout() {
    const next = !autoLayout
    setAutoLayout(next)
    try { localStorage.setItem('planGraph.autoLayout', String(next)) } catch { /* ignore */ }
    if (next && !!nodes?.length) {
      applyLayout()
    }
  }

  function applyLayout() {
    if (!nodes?.length) return
    const laidNodes = applyHierarchicalLayout([...nodes], [...edges])
    setNodes(laidNodes)
    // Fit view after layout change
    setTimeout(() => reactFlowInstance.current?.fitView({ padding: 0.2 }), 0)
    // Push changes to server
    debouncedSaveNodes()
  }

  // Filter node types that can be created manually
  const creatableNodeTypes = getCreatableNodeTypes()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-muted-foreground text-sm">{t('billing.loading')}</span>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full">
      {/* Toolbar */}
      <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5 bg-background border border-border rounded shadow px-2 py-1.5 flex-wrap">
        {creatableNodeTypes.map((nodeType) => (
          <button
            key={nodeType}
            onClick={() => openAddDialog(nodeType)}
            title={t(`planGraph.add${nodeType.charAt(0).toUpperCase() + nodeType.slice(1)}Node`)}
            className="text-xs px-2 py-1 rounded border border-border hover:bg-muted transition-colors"
          >
            {t(`planGraph.add${nodeType.charAt(0).toUpperCase() + nodeType.slice(1)}Node`)}
          </button>
        ))}
        <div className="w-px h-4 bg-border mx-0.5" />
        <label className="flex items-center gap-1 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={autoLayout}
            onChange={toggleAutoLayout}
            className="w-3 h-3"
          />
          {t('planGraph.autoLayout')}
        </label>
        {!autoLayout && (
          <button
            onClick={applyLayout}
            className="text-xs px-2 py-1 rounded border border-border hover:bg-muted transition-colors"
          >
            {t('planGraph.applyLayout')}
          </button>
        )}
        <div className="w-px h-4 bg-border mx-0.5" />
        <button
          onClick={() => setShowGenerateAll(true)}
          className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          ▶ {t('planGraph.generateAll')}
        </button>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onNodeContextMenu={onNodeContextMenu}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        viewport={viewport}
        onViewportChange={setViewport}
        nodesDraggable={!autoLayout}
        zoomOnDoubleClick={false}
        onInit={(instance) => { reactFlowInstance.current = instance }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls />
        <MiniMap nodeStrokeWidth={2} zoomable pannable />
      </ReactFlow>

      {/* Edge type selection dialog */}
      {showConnectDialog && (() => {
        const sourceNode = nodes.find(n => n.id === showConnectDialog.source)
        const targetNode = nodes.find(n => n.id === showConnectDialog.target)
        const sourceType = sourceNode?.data.type as PlanNodeType | undefined
        const targetType = targetNode?.data.type as PlanNodeType | undefined

        const allowedEdgeTypes = EDGE_TYPES.filter(edgeDef =>
          sourceType && targetType && canCreateEdge(sourceType, targetType, edgeDef.id)
        ).map(edgeDef => edgeDef.id)

        return (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-background border border-border rounded-lg shadow-xl p-4 w-64">
              <h3 className="text-sm font-semibold mb-3">{t('planGraph.selectEdgeType')}</h3>
              <div className="flex flex-col gap-2">
                {allowedEdgeTypes.map(type => (
                  <button
                    key={type}
                    onClick={() => void confirmConnect(type)}
                    className="px-3 py-1.5 text-sm rounded border border-border hover:bg-muted text-left"
                  >
                    {t(`planGraph.edge.${type}`)}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowConnectDialog(null)}
                className="mt-3 w-full text-xs text-muted-foreground hover:text-foreground"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )
      })()}

      {/* Generate All dialog */}
      {showGenerateAll && (
        <GenerateAllDialog onClose={() => setShowGenerateAll(false)} />
      )}

      {/* Add node dialog */}
      {addDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-background border border-border rounded-lg shadow-xl p-4 w-72">
            <h3 className="text-sm font-semibold mb-3">
              {t(`planGraph.add${addDialog.type.charAt(0).toUpperCase() + addDialog.type.slice(1)}Node`)}
            </h3>
            <input
              ref={addTitleInputRef}
              type="text"
              value={addTitle}
              onChange={e => setAddTitle(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') void confirmAddNode()
                if (e.key === 'Escape') { setAddDialog(null); setAddTitle('') }
              }}
              placeholder={t('planGraph.nodeTitle')}
              className="w-full px-3 py-1.5 text-sm border border-border rounded bg-background focus:outline-none focus:ring-1 focus:ring-ring mb-3"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setAddDialog(null); setAddTitle('') }}
                className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => void confirmAddNode()}
                disabled={!addTitle.trim()}
                className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {t('common.add')}
              </button>
            </div>
          </div>
        </div>
      )}

      <ContextMenu>
        <ContextMenuTrigger asChild>
          <span ref={contextMenuTriggerRef} className="hidden" /> 
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            onSelect={() => {
              if (contextMenuNodeId) {
                aiGenerateSummary(contextMenuNodeId)
              }
            }}
          >
            {t('planGraph.aiGenerateSummary')}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onSelect={() => { if (contextMenuNodeId) deleteNode(contextMenuNodeId) }}
          >
            {t('planGraph.deleteNode')}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  )
}

function excludeDuplicates<T extends {}>(objA: T, objB: any) : Partial<T> {
  return Object.fromEntries(
    Object.entries(objA).filter(([key, value]) => objB[key] !== value && value != undefined)
  ) as Partial<T>
};