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
import type { PlanGraphNode, PlanGraphEdge } from '../types/models'
import PlanTextNode from './plan-graph/PlanTextNode'
import PlanLoreNode from './plan-graph/PlanLoreNode'
import PlanMergeNode from './plan-graph/PlanMergeNode'
import PlanEdgeComponent from './plan-graph/PlanEdge'
import GenerateAllDialog from './plan-graph/GenerateAllDialog'
import { ipcClient } from '../ipcClient'

type PlanGraphNodeData = PlanGraphNode & { onDelete: (id: string) => void }
type PlanGraphEdgeData = { type: string; label?: string; onDelete: (id: string) => void }

const nodeTypes = {
  planText: PlanTextNode,
  planLore: PlanLoreNode,
  planMerge: PlanMergeNode,
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

function toReactFlowNodes(graphNodes: PlanGraphNode[], onDelete: (id: string) => void): Node[] {
  return graphNodes.map(n => ({
    id: String(n.id),
    type: n.type === 'lore' ? 'planLore' : n.type === 'merge' ? 'planMerge' : 'planText',
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
  const [addDialog, setAddDialog] = useState<{ type: 'text' | 'lore' | 'merge' } | null>(null)
  const [addTitle, setAddTitle] = useState('')
  const addTitleInputRef = useRef<HTMLInputElement>(null)
  const reactFlowInstance = useRef<any>(null)
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 })
  const hasFitted = useRef(false)

  const loadGraph = useCallback(async () => {
    try {
      const data = await ipcClient.graph.get()

      const rfEdges = toReactFlowEdges(data.edges, deleteEdge)
      let rfNodes = toReactFlowNodes(data.nodes, deleteNode)

      if (autoLayout && rfNodes.length > 0) {
        rfNodes = applyDagreLayout(rfNodes, rfEdges)
        // Persist positions after auto-layout
        for (const n of rfNodes) {
          void ipcClient.graph.patchNode(Number(n.id), { x: n.position.x, y: n.position.y })
        }
      }

      setNodes(rfNodes)
      setEdges(rfEdges)
      setLoading(false)
    } catch {
      setLoading(false)
    }
  }, [autoLayout]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
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
  }, [])

  // Fit view after nodes are loaded and when layout changes
  useEffect(() => {
    if (nodes.length > 0 && !hasFitted.current && reactFlowInstance.current) {
      reactFlowInstance.current.fitView({ padding: 0.2 })
      hasFitted.current = true
    }
  }, [nodes])

  async function deleteNode(nodeId: string) {
    if (!window.confirm('Delete this node and all connected edges?')) return
    const result = await ipcClient.graph.deleteNode(Number(nodeId))
    if (result.ok) dispatchPlanGraphRefresh()
  }

  async function deleteEdge(edgeId: string) {
    const result = await ipcClient.graph.deleteEdge(Number(edgeId))
    if (result.ok) {
      setEdges(prev => prev.filter(e => e.id !== edgeId))
    }
  }

  function openAddDialog(type: 'text' | 'lore' | 'merge') {
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
    await ipcClient.graph.createNode({ type, title, x: centerX, y: centerY })
    dispatchPlanGraphRefresh()
  }

  const onNodeDragStop = useCallback((_: React.MouseEvent, node: Node) => {
    if (autoLayout) return
    void ipcClient.graph.patchNode(Number(node.id), { x: node.position.x, y: node.position.y })
  }, [autoLayout])

  const onConnect = useCallback((connection: Connection) => {
    // If connecting to a merge node, automatically create a merge_into edge
    if (connection.target && connection.source) {
      const targetNode = nodes.find(n => n.id === connection.target)
      if (targetNode?.data.type === 'merge') {
        // Create the edge directly without showing dialog
        void ipcClient.graph.createEdge({
          from_node_id: Number(connection.source),
          to_node_id: Number(connection.target),
          type: 'merge_into',
        }).then(result => {
          const newEdge: Edge = {
            id: String(result.id),
            source: connection.source!,
            target: connection.target!,
            type: 'planEdge',
            data: { type: 'merge_into', onDelete: deleteEdge },
          }
          setEdges(prev => addEdge(newEdge, prev))
        })
        return
      }
    }
    // Otherwise show the dialog for other edge types
    setShowConnectDialog(connection)
  }, [nodes, deleteEdge])


  async function confirmConnect(edgeType: string) {
    if (!showConnectDialog?.source || !showConnectDialog?.target) return
    const result = await ipcClient.graph.createEdge({
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
    setEdges(prev => addEdge(newEdge, prev))
    setShowConnectDialog(null)
  }

  function toggleAutoLayout() {
    const next = !autoLayout
    setAutoLayout(next)
    try { localStorage.setItem('planGraph.autoLayout', String(next)) } catch { /* ignore */ }
    if (next && nodes.length > 0) {
      const laid = applyDagreLayout([...nodes], [...edges])
      setNodes(laid)
      for (const n of laid) {
        void ipcClient.graph.patchNode(Number(n.id), { x: n.position.x, y: n.position.y })
      }
      // Fit view after layout change
      setTimeout(() => reactFlowInstance.current?.fitView({ padding: 0.2 }), 0)
    }
  }

  function applyLayout() {
    if (nodes.length === 0) return
    const laid = applyDagreLayout([...nodes], [...edges])
    setNodes(laid)
    for (const n of laid) {
      void ipcClient.graph.patchNode(Number(n.id), { x: n.position.x, y: n.position.y })
    }
    // Fit view after layout change
    setTimeout(() => reactFlowInstance.current?.fitView({ padding: 0.2 }), 0)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-muted-foreground text-sm">Loading…</span>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full">
      {/* Toolbar */}
      <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5 bg-background border border-border rounded shadow px-2 py-1.5 flex-wrap">
        <button
          onClick={() => openAddDialog('text')}
          title={t('planGraph.addTextNode')}
          className="text-xs px-2 py-1 rounded border border-border hover:bg-muted transition-colors"
        >
          {t('planGraph.addTextNode')}
        </button>
        <button
          onClick={() => openAddDialog('lore')}
          title={t('planGraph.addLoreNode')}
          className="text-xs px-2 py-1 rounded border border-border hover:bg-muted transition-colors"
        >
          {t('planGraph.addLoreNode')}
        </button>
        <button
          onClick={() => openAddDialog('merge')}
          title={t('planGraph.addMergeNode')}
          className="text-xs px-2 py-1 rounded border border-border hover:bg-muted transition-colors"
        >
          {t('planGraph.addMergeNode')}
        </button>
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
      {showConnectDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-background border border-border rounded-lg shadow-xl p-4 w-64">
            <h3 className="text-sm font-semibold mb-3">Select edge type</h3>
            <div className="flex flex-col gap-2">
              {(['instruction', 'attachment', 'system_prompt', 'merge_into'] as const).map(type => (
                <button
                  key={type}
                  onClick={() => void confirmConnect(type)}
                  className="px-3 py-1.5 text-sm rounded border border-border hover:bg-muted text-left"
                >
                  {t(`planGraph.edge.${type}` as Parameters<typeof t>[0])}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowConnectDialog(null)}
              className="mt-3 w-full text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Generate All dialog */}
      {showGenerateAll && (
        <GenerateAllDialog onClose={() => setShowGenerateAll(false)} />
      )}

      {/* Add node dialog */}
      {addDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-background border border-border rounded-lg shadow-xl p-4 w-72">
            <h3 className="text-sm font-semibold mb-3">
              {addDialog.type === 'text' ? t('planGraph.addTextNode') : t('planGraph.addLoreNode')}
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
    </div>
  )
}
