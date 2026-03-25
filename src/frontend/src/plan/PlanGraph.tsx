import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type Viewport,
  BackgroundVariant,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from '@dagrejs/dagre'
import { useLocale } from '../lib/locale'
import { PLAN_GRAPH_REFRESH_EVENT, dispatchPlanGraphRefresh } from '../lib/plan-graph-events'
import { PLAN_NODE_SAVED_EVENT, type PlanNodeSavedDetail } from '../lib/plan-events'
import type { PlanGraphEdge } from '../types/models'
import { type PlanNodeType, NODE_TYPES } from '@shared/plan-graph'
import { EDGE_TYPES, canCreateEdge } from '@shared/node-edge-dictionary'
import PlanTextNode from './plan-graph/PlanTextNode'
import PlanLoreNode from './plan-graph/PlanLoreNode'
import PlanMergeNode from './plan-graph/PlanMergeNode'
import PlanSplitterNode from './plan-graph/PlanSplitterNode'
import PlanEdgeComponent from './plan-graph/PlanEdge'
import GenerateAllDialog from './GenerateAllDialog'
import { ipcClient } from '../ipcClient'
import { PlanNodeRow } from '@shared/plan-graph'

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

function toReactFlowNodes(graphNodes: PlanNodeRow[], onDelete: (id: string) => void): Node[] {
  return graphNodes.map(n => ({
    id: String(n.id),
    type: n.type === 'lore' ? 'planLore' : n.type === 'merge' ? 'planMerge' : n.type === 'split' ? 'planSplitter' : 'planText',
    position: { x: n.x ?? 0, y: n.y ?? 0 },
    data: { ...n, onDelete },
  }))
}

function toReactFlowEdges(graphEdges: PlanGraphEdge[], onDeleteEdge: (id: string) => void): Edge[] {
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
  const [nodes, setNodes, onNodesChange] = useNodesState<any>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<any>([])

  const [autoLayout, setAutoLayout] = useState<boolean>(() => {
    try { return localStorage.getItem('planGraph.autoLayout') !== 'false' }
    catch { return true }
  })
  const [showConnectDialog, setShowConnectDialog] = useState<Connection | null>(null)
  const [showGenerateAll, setShowGenerateAll] = useState(false)
  const [loading, setLoading] = useState(true)
  const [addDialog, setAddDialog] = useState<{ type: PlanNodeType } | null>(null)
  const [addTitle, setAddTitle] = useState('')
  const addTitleInputRef = useRef<HTMLInputElement>(null)
  const reactFlowInstance = useRef<any>(null)
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 })
  const [contextMenu, setContextMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null)
  const hasFitted = useRef(false)

  const deleteNode = useCallback(async (nodeId: string) => {
    const message = t('planGraph.deleteConfirmation')
    const confirmed = window.electronAPI.confirm(message)
    if (!confirmed) return
    const result = await ipcClient.plan.nodes.delete.mutate(Number(nodeId))
    if (result.ok) dispatchPlanGraphRefresh()
  }, [t])

  const deleteEdge = useCallback(async (edgeId: string) => {
    const result = await ipcClient.plan.edges.delete.mutate(Number(edgeId))
    if (result.ok) {
      setEdges(prev => {
        const newEdges = prev.filter(e => e.id !== edgeId)
        if (autoLayout) {
          setNodes(prevNodes => {
            const laid = applyDagreLayout([...prevNodes], newEdges)
            for (const n of laid) {
              void ipcClient.plan.nodes.patch.mutate({id: Number(n.id), data: { x: n.position.x, y: n.position.y }})
            }
            return laid.map(node => ({ ...node, transitionDuration: 1000 }))
          })
          setTimeout(() => reactFlowInstance.current?.fitView({ padding: 0.2 }), 0)
        }
        return newEdges
      })
    }
  }, [autoLayout, setEdges, setNodes])

  const loadGraph = useCallback(async () => {
    try {
      const [graphNodes, graphEdges] = await Promise.all([
        ipcClient.plan.nodes.getAll.query(),
        ipcClient.plan.edges.getAll.query(),
      ])

      const rfEdges = toReactFlowEdges(graphEdges, deleteEdge)
      let rfNodes = toReactFlowNodes(graphNodes, deleteNode)

      if (autoLayout && rfNodes.length > 0) {
        rfNodes = applyDagreLayout(rfNodes, rfEdges)
        // Persist positions after auto-layout
        for (const n of rfNodes) {
          void ipcClient.plan.nodes.patch.mutate({id: Number(n.id), data: { x: n.position.x, y: n.position.y }})
        }
      }

      setNodes(rfNodes)
      setEdges(rfEdges)
      setLoading(false)
    } catch {
      setLoading(false)
    }
  }, [autoLayout, deleteEdge, deleteNode, setNodes, setEdges])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadGraph()
  }, [loadGraph])

  useEffect(() => {
    const handler = () => void loadGraph()
    window.addEventListener(PLAN_GRAPH_REFRESH_EVENT, handler)
    return () => window.removeEventListener(PLAN_GRAPH_REFRESH_EVENT, handler)
  }, [loadGraph])

  // Update node title when a plan node is saved
  useEffect(() => {
    const handler = (e: Event) => {
      const { id, title } = (e as CustomEvent<PlanNodeSavedDetail>).detail
      if (title === undefined) return
      setNodes(prev => prev.map(node =>
        node.id === String(id)
          ? { ...node, data: { ...node.data, title } }
          : node
      ))
    }
    window.addEventListener(PLAN_NODE_SAVED_EVENT, handler)
    return () => window.removeEventListener(PLAN_NODE_SAVED_EVENT, handler)
  }, [setNodes])

  // Fit view after nodes are loaded and when layout changes
  useEffect(() => {
    if (nodes.length > 0 && !hasFitted.current && reactFlowInstance.current) {
      reactFlowInstance.current.fitView({ padding: 0.2 })
      hasFitted.current = true
    }
  }, [nodes, setNodes])

  function openAddDialog(type: PlanNodeType) {
    setAddTitle('')
    setAddDialog({ type })
    // focus the input on next paint
    setTimeout(() => addTitleInputRef.current?.focus(), 0)
  }

  async function confirmAddNode() {
    if (!addTitle.trim() || !addDialog) return
    const title = addTitle.trim()
    const type = addDialog.type
    setAddDialog(null)
    setAddTitle('')
    const centerX = 100 + Math.random() * 200
    const centerY = 100 + Math.random() * 200
    await ipcClient.plan.nodes.create.mutate({ type, title, x: centerX, y: centerY })
    dispatchPlanGraphRefresh()
  }

  const onNodeDragStop = useCallback((_: React.MouseEvent, node: Node) => {
    if (autoLayout) return
    void ipcClient.plan.nodes.patch.mutate({id: Number(node.id), data: { x: node.position.x, y: node.position.y }})
  }, [autoLayout])

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault()
    setContextMenu({
      nodeId: node.id,
      x: event.clientX,
      y: event.clientY,
    })
  }, [])

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) {
      return
    }
    const sourceNode = nodes.find(n => n.id === connection.source)
    const targetNode = nodes.find(n => n.id === connection.target)
    const sourceType = sourceNode?.data.type as PlanNodeType | undefined
    const targetType = targetNode?.data.type as PlanNodeType | undefined

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
      void ipcClient.plan.edges.create.mutate({
        from_node_id: Number(connection.source),
        to_node_id: Number(connection.target),
        type: edgeType,
      }).then(result => {
        const newEdge: Edge = {
          id: String(result.id),
          source: connection.source,
          target: connection.target,
          type: 'planEdge',
          data: { type: edgeType, onDelete: deleteEdge },
        }
        const updatedEdges = addEdge(newEdge, edges)
        setEdges(updatedEdges)
        if (autoLayout) {
          const laid = applyDagreLayout([...nodes], updatedEdges)
          setNodes(laid.map(node => ({ ...node, transitionDuration: 1000 })))
          for (const n of laid) {
            void ipcClient.plan.nodes.patch.mutate({id: Number(n.id), data: { x: n.position.x, y: n.position.y }})
          }
          setTimeout(() => reactFlowInstance.current?.fitView({ padding: 0.2 }), 0)
        }
      }).catch(err => {
        console.error('Failed to create edge:', err)
      })
      return
    }

    // Multiple allowed edge types, show selection dialog
    setShowConnectDialog(connection)
  }, [nodes, deleteEdge, edges, autoLayout, setNodes, setEdges])


  async function confirmConnect(edgeType: string) {
    if (!showConnectDialog?.source || !showConnectDialog?.target) return
    const result = await ipcClient.plan.edges.create.mutate({
      from_node_id: Number(showConnectDialog.source),
      to_node_id: Number(showConnectDialog.target),
      type: edgeType,
    })
    const newEdge: Edge = {
      id: String(result.id),
      source: showConnectDialog.source,
      target: showConnectDialog.target,
      type: 'planEdge',
      data: { type: edgeType, onDelete: deleteEdge },
    }
    const updatedEdges = addEdge(newEdge, edges)
    setEdges(updatedEdges)
    if (autoLayout) {
      const laid = applyDagreLayout([...nodes], updatedEdges)
      setNodes(laid.map(node => ({ ...node, transitionDuration: 1000 })))
      for (const n of laid) {
        void ipcClient.plan.nodes.patch.mutate({id:Number(n.id), data: { x: n.position.x, y: n.position.y }})
      }
      setTimeout(() => reactFlowInstance.current?.fitView({ padding: 0.2 }), 0)
    }
    setShowConnectDialog(null)
  }

  function toggleAutoLayout() {
    const next = !autoLayout
    setAutoLayout(next)
    try { localStorage.setItem('planGraph.autoLayout', String(next)) } catch { /* ignore */ }
    if (next && nodes.length > 0) {
      applyLayout()
    }
  }

  function applyLayout() {
    if (nodes.length === 0) return
    const laid = applyDagreLayout([...nodes], [...edges])
    setNodes(laid.map(node => ({ ...node, transitionDuration: 1000 })))
    for (const n of laid) {
      void ipcClient.plan.nodes.patch.mutate({id:Number(n.id), data: { x: n.position.x, y: n.position.y }})
    }
    // Fit view after layout change
    setTimeout(() => reactFlowInstance.current?.fitView({ padding: 0.2 }), 0)
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
              deleteNode(contextMenu.nodeId)
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
