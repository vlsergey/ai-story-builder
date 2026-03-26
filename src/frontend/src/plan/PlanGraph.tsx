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
import dagre from '@dagrejs/dagre'
import { useLocale } from '../lib/locale'
import type { PlanGraphEdge } from '../types/models'
import { type PlanNodeType, NODE_TYPES, PlanNodeUpdate } from '@shared/plan-graph'
import { EDGE_TYPES, canCreateEdge } from '@shared/node-edge-dictionary'
import PlanTextNode from './plan-graph/PlanTextNode'
import PlanLoreNode from './plan-graph/PlanLoreNode'
import PlanMergeNode from './plan-graph/PlanMergeNode'
import PlanSplitterNode from './plan-graph/PlanSplitterNode'
import PlanEdgeComponent from './plan-graph/PlanEdge'
import GenerateAllDialog from './GenerateAllDialog'
import { trpc } from '../ipcClient'
import { PlanNodeRow } from '@shared/plan-graph'
import debounce from "lodash/debounce";

const nodeTypes = {
  planText: PlanTextNode,
  planLore: PlanLoreNode,
  planMerge: PlanMergeNode,
  planSplitter: PlanSplitterNode,
}

const edgeTypes = {
  planEdge: PlanEdgeComponent,
}

function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 120 })
  g.setDefaultEdgeLabel(() => ({}))
  nodes.forEach(n => g.setNode(n.id, { width: 200, height: 80 }))
  edges.forEach(e => g.setEdge(e.source, e.target))
  dagre.layout(g)
  return nodes.map(n => {
    const pos = g.node(n.id)
    if (!pos) return n
    return { ...n, position: { x: pos.x - 100, y: pos.y - 40 } }
  })
}

function toReactFlowNodes(graphNodes: PlanNodeRow[], onDelete: (id: number) => void): Node[] {
  return graphNodes.map(n => ({
    id: String(n.id),
    type: n.type === 'lore' ? 'planLore' : n.type === 'merge' ? 'planMerge' : n.type === 'split' ? 'planSplitter' : 'planText',
    position: { x: n.x ?? 0, y: n.y ?? 0 },
    data: { ...n, onDelete },
  }))
}

function toReactFlowEdges(graphEdges: PlanGraphEdge[], onDeleteEdge: (id: number) => void): Edge[] {
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

  const { data: serverNodes, isLoading: areNodesLoading } = trpc.plan.nodes.getAll.useQuery()
  const { data: serverEdges, isLoading: areEdgesLoading } = trpc.plan.edges.getAll.useQuery()
  const loading = areNodesLoading || areEdgesLoading
  const deleteEdge = trpc.plan.edges.delete.useMutation().mutate
  const deleteNodeMutation = trpc.plan.nodes.delete.useMutation().mutate

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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedSaveNodes = useCallback(debounce(() => {
    const toPatch: { id: number, data: PlanNodeUpdate }[] = nodes
      .map(n => ({ id: Number(n.id), data: { x: n.position.x, y: n.position.y } }))
    patchNodes(toPatch)
  }, 1000), [nodes, patchNodes]);

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
  const [contextMenu, setContextMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null)
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
    patchNode({id: Number(node.id), data: { x: node.position.x, y: node.position.y }})
  }, [autoLayout, patchNode])

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault()
    setContextMenu({
      nodeId: node.id,
      x: event.clientX,
      y: event.clientY,
    })
  }, [])

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
    const laidNodes = applyDagreLayout([...nodes], [...edges])
    setNodes(laidNodes)
    // Fit view after layout change
    setTimeout(() => reactFlowInstance.current?.fitView({ padding: 0.2 }), 0)
    // Push changes to server
    debouncedSaveNodes()
  }

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
        {NODE_TYPES.map((nodeType) => (
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

      {/* Context menu for nodes */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-background border border-border rounded shadow-lg w-40"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="w-full text-left px-3 py-2 text-sm hover:bg-muted rounded-t"
            onClick={() => {
              deleteNode(Number(contextMenu.nodeId))
              setContextMenu(null)
            }}
          >
            {t('planGraph.deleteNode')}
          </button>
          <button
            className="w-full text-left px-3 py-2 text-sm hover:bg-muted rounded-b border-t border-border"
            onClick={() => setContextMenu(null)}
          >
            {t('common.cancel')}
          </button>
        </div>
      )}
    </div>
  )
}
