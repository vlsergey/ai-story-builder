import { sortByHierarchy } from "@/lib/sortByHierarchy"
import { ContextMenu, ContextMenuTrigger } from "@/ui-components/context-menu"
import { EDGE_TYPES_DEFS, canCreateEdge, getNodeTypeDefinition } from "@shared/node-edge-dictionary"
import type { PlanEdgeRow, PlanEdgeType, PlanNodeRow, PlanNodeType, PlanNodeUpdate } from "@shared/plan-graph"
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useDebouncedCallback } from "use-debounce"
import { trpc } from "../../ipcClient"
import { useLocale } from "../../lib/locale"
import EdgeContextMenu from "./EdgeContextMenu"
import EdgeTypeSelectionDialog from "./EdgeTypeSelectionDialog"
import GroupNode from "./GroupNode"
import { applyHierarchicalLayout } from "./hierarchical-layout"
import ContextMenuContent from "./NodeContextMenuContent"
import PlanEdgeComponent from "./PlanEdge"
import SimpleNode from "./SimpleNode"
import Toolbar from "./Toolbar"
import type { EdgeImpl, NodeImpl } from "./Types"
import useConfirm from "@/native/useConfirm"
import useAlert from "@/native/useAlert"

const nodeTypes: Record<"simple" | "group", React.FC<NodeProps<NodeImpl>>> = {
  simple: SimpleNode,
  group: GroupNode,
}

const edgeTypes: Record<PlanEdgeType, React.FC<EdgeProps<EdgeImpl> & { data: PlanEdgeRow }>> = {
  text: PlanEdgeComponent,
  textArray: PlanEdgeComponent,
}

function toReactFlowNodes(graphNodes: PlanNodeRow[], onDelete: (id: number) => void): NodeImpl[] {
  const sortedByHierarchy = sortByHierarchy(
    graphNodes,
    (n) => n.id,
    (n) => n.parent_id,
  )
  return sortedByHierarchy.map((n) => {
    const childCount = graphNodes.filter((child) => child.parent_id === n.id).length
    const nodeDef = getNodeTypeDefinition(n.type)
    const isGroup = nodeDef?.isGroup ?? false
    const isConfined = nodeDef?.confined ?? false
    const width = n.width ?? 200
    const height = n.height ?? 100
    const extent = isConfined ? "parent" : undefined
    return {
      id: String(n.id),
      type: isGroup ? "group" : "simple",
      position: { x: n.x ?? 0, y: n.y ?? 0 },
      parentId: n.parent_id ? String(n.parent_id) : undefined,
      data: { ...n, onDelete, childCount },
      width: width,
      height: height,
      extent,
    } as NodeImpl
  })
}

function toReactFlowEdges(graphEdges: PlanEdgeRow[], onDeleteEdge: (id: number) => void): EdgeImpl[] {
  return graphEdges.map((e) => ({
    id: String(e.id),
    source: String(e.from_node_id),
    target: String(e.to_node_id),
    type: e.type,
    data: { ...e, onDelete: onDeleteEdge },
  }))
}

export default function PlanGraph() {
  const { t } = useLocale()
  const [nodes, setNodes, onNodesChangeImpl] = useNodesState<NodeImpl>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<EdgeImpl>([])

  const findAllNodes = trpc.plan.nodes.findAll.useQuery(undefined, {
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    refetchOnMount: true,
    onSuccess: () => {
      console.log("Reloaded nodes from server")
    },
  })
  const findAllEdges = trpc.plan.edges.findAll.useQuery(undefined, {
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    refetchOnMount: true,
    onSuccess: () => {
      console.log("Reloaded edges from server")
    },
  })
  const loading = findAllNodes.isLoading || findAllEdges.isLoading
  const deleteEdge = trpc.plan.edges.delete.useMutation().mutate
  const deleteNodeMutation = trpc.plan.nodes.delete.useMutation().mutate
  const aiGenerateSummary = trpc.plan.nodes.aiGenerateSummary.useMutation().mutate
  const saveToFileMutation = trpc.plan.nodes.saveContentToFile.useMutation().mutateAsync
  const saveFileDialogMutation = trpc.native.saveFileDialog.useMutation().mutateAsync
  const alert = useAlert()
  const confirm = useConfirm()

  const deleteNode = useCallback(
    async (nodeId: number) => {
      const confirmed = await confirm("planGraph.deleteConfirmation")
      if (!confirmed) return
      deleteNodeMutation(nodeId)
    },
    [deleteNodeMutation, confirm],
  )

  const saveToFile = useCallback(
    async (nodeId: number) => {
      const node = findAllNodes.data?.find((n) => n.id === nodeId)
      if (!node) {
        console.error("Node not found", nodeId)
        return
      }
      const filters = [
        { name: t("fileFilterName.txt"), extensions: ["txt"] },
        { name: t("fileFilterName.md"), extensions: ["md"] },
        { name: t("fileFilterName.*"), extensions: ["*"] },
      ]
      const defaultPath = `${node.title.replace(/[\\/:*?"<>|\x00]/g, "_")}.txt`
      const filePath = await saveFileDialogMutation({ defaultPath, filters })
      if (!filePath) {
        // User cancelled
        return
      }
      try {
        await saveToFileMutation({ nodeId, filePath })
      } catch (error) {
        await alert(`Failed to save file: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
    [findAllNodes.data, saveFileDialogMutation, saveToFileMutation, alert, t],
  )

  // replace local cache with server data
  useEffect(() => {
    if (findAllNodes.isFetched) setNodes(toReactFlowNodes(findAllNodes.data ?? [], deleteNode))
  }, [findAllNodes.isFetched, findAllNodes.data, deleteNode, setNodes])
  useEffect(() => {
    if (findAllEdges.isFetched) setEdges(toReactFlowEdges(findAllEdges.data ?? [], deleteEdge))
  }, [findAllEdges.isFetched, findAllEdges.data, deleteEdge, setEdges])

  const patchNodes = trpc.plan.nodes.batchPatch.useMutation().mutate

  const debouncedSaveNodes = useDebouncedCallback(() => {
    const toPatch = nodes
      .map((n) => {
        const data: PlanNodeUpdate = excludeDuplicates(
          {
            x: n.position.x,
            y: n.position.y,
            width: n.width,
            height: n.height,
          },
          n.data,
        )

        if (Object.keys(data).length > 0) {
          console.log(`[PlanGraph] Patching node ${n.id}`, data)
          return { id: Number(n.id), data }
        }
        return null
      })
      .filter((n) => n !== null)

    if (toPatch.length > 0) {
      patchNodes(toPatch)
    }
  }, 1000)

  // update
  const onNodesChange = useCallback(
    (nodeChanges: NodeChange<NodeImpl>[]) => {
      onNodesChangeImpl(nodeChanges)
      debouncedSaveNodes()
    },
    [debouncedSaveNodes, onNodesChangeImpl],
  )

  const [autoLayout, setAutoLayout] = useState<boolean>(() => {
    try {
      return localStorage.getItem("planGraph.autoLayout") !== "false"
    } catch {
      return true
    }
  })
  const [showConnectDialog, setShowConnectDialog] = useState<Connection | null>(null)
  const reactFlowInstance = useRef<ReactFlowInstance<NodeImpl, EdgeImpl>>(null)
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 })
  const hasFitted = useRef(false)

  // Fit view after nodes are loaded and when layout changes
  useEffect(() => {
    if ((nodes?.length || 0) > 0 && !hasFitted.current && reactFlowInstance.current) {
      reactFlowInstance.current.fitView({ padding: 0.2 })
      hasFitted.current = true
    }
  }, [nodes])

  const patchNode = trpc.plan.nodes.patch.useMutation().mutateAsync
  const regenerateNode = trpc.plan.nodes.aiGenerateOnly.useMutation().mutateAsync

  const onNodeDragStop = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (autoLayout) return

      // Find containing group (nodes with isGroup flag) using getIntersectingNodes
      let newParentId: number | null = null
      const intersecting = reactFlowInstance.current?.getIntersectingNodes(node, true) || []
      for (const n of intersecting) {
        if (n.id === node.id) continue // skip self
        const def = getNodeTypeDefinition(n.data.type)
        if (def?.isGroup === true) {
          newParentId = Number(n.id)
          break
        }
      }

      // Validate: cannot be parent of itself
      if (newParentId === Number(node.id)) {
        newParentId = null
      }

      // Determine current parent from server data
      const currentParentId = node.parentId ? Number(node.parentId) : null

      // Prepare update data
      if (newParentId !== currentParentId && !getNodeTypeDefinition(node.data.type as PlanNodeType)?.confined) {
        return patchNode({ id: Number(node.id), manual: true, data: { parent_id: newParentId } })
      }
    },
    [autoLayout, patchNode],
  )

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
  }, [])

  const scheduleLayout = useCallback(() => {
    if (autoLayout) {
      setTimeout(() => reactFlowInstance.current?.fitView({ padding: 0.2 }), 0)
    }
  }, [autoLayout])

  const createEdge = trpc.plan.edges.create.useMutation({
    onSuccess: scheduleLayout,
  }).mutate

  const onConnect = useCallback(
    (connection: Connection) => {
      console.info(`[PlannGraph] Attempting to connect ${connection.source} to ${connection.target}`)
      if (!connection.source || !connection.target) {
        return
      }
      const sourceNode = (nodes || []).find((n) => n.id === connection.source)
      const targetNode = (nodes || []).find((n) => n.id === connection.target)
      const sourceType = sourceNode?.data?.type ?? (sourceNode?.type as PlanNodeType | undefined)
      const targetType = targetNode?.data?.type ?? (targetNode?.type as PlanNodeType | undefined)

      if (!sourceType || !targetType) {
        return
      }

      const allowedEdgeTypes = EDGE_TYPES_DEFS.filter((edgeDef) =>
        canCreateEdge(sourceType as PlanNodeType, targetType as PlanNodeType, edgeDef.id),
      ).map((edgeDef) => edgeDef.id)

      if (allowedEdgeTypes.length === 0) {
        console.info(
          `[PlannGraph] Ignore connection try because no compatible edge types between ${sourceType} and ${targetType}`,
        )
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
    },
    [nodes, createEdge],
  )

  const [edgeContextMenuData, setEdgeContextMenuData] = useState<{
    edge: PlanEdgeRow
    source: PlanNodeRow
    target: PlanNodeRow
  } | null>(null)
  const edgeContextMenuTrigger = useRef<HTMLDivElement>(null)

  const onEdgeContextMenu = useCallback(
    (event: React.MouseEvent, rfEdge: EdgeImpl) => {
      const edge = rfEdge.data
      const source = edge?.from_node_id ? findAllNodes.data?.find((n) => n.id === edge?.from_node_id) : undefined
      const target = edge?.to_node_id ? findAllNodes.data?.find((n) => n.id === edge?.to_node_id) : undefined

      if (edge !== undefined && source !== undefined && target !== undefined) {
        event.preventDefault()

        console.debug(`[onEdgeContextMenu] Open context menu for ${edge.id}`)
        setEdgeContextMenuData({ edge, source, target })

        const mouseEvent = new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          view: window,
          // Вот здесь магия: передаем координаты напрямую в событие
          clientX: event.clientX,
          clientY: event.clientY,
        })
        edgeContextMenuTrigger.current?.dispatchEvent(mouseEvent)
      }
    },
    [findAllNodes.data],
  )

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
    try {
      localStorage.setItem("planGraph.autoLayout", String(next))
    } catch {
      /* ignore */
    }
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

  // Compute allowed edge types for the dialog
  const allowedEdgeTypes = showConnectDialog
    ? (() => {
        const sourceNode = nodes.find((n) => n.id === showConnectDialog.source)
        const targetNode = nodes.find((n) => n.id === showConnectDialog.target)
        const sourceType = sourceNode?.data.type as PlanNodeType | undefined
        const targetType = targetNode?.data.type as PlanNodeType | undefined
        return EDGE_TYPES_DEFS.filter(
          (edgeDef) =>
            sourceType &&
            targetType &&
            canCreateEdge(sourceType as PlanNodeType, targetType as PlanNodeType, edgeDef.id),
        ).map((edgeDef) => edgeDef.id)
      })()
    : []

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-muted-foreground text-sm">{t("billing.loading")}</span>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full">
      <Toolbar
        className="absolute top-2 left-2 z-10"
        autoLayout={autoLayout}
        toggleAutoLayout={toggleAutoLayout}
        applyLayout={applyLayout}
      />

      <ReactFlow<NodeImpl, EdgeImpl>
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onEdgeContextMenu={onEdgeContextMenu}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onNodeContextMenu={onNodeContextMenu}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        viewport={viewport}
        onViewportChange={setViewport}
        nodesDraggable={!autoLayout}
        minZoom={0.125}
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
        onInit={(instance) => {
          reactFlowInstance.current = instance
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls />
        <MiniMap nodeStrokeWidth={2} zoomable pannable />
      </ReactFlow>

      <EdgeTypeSelectionDialog
        showConnectDialog={showConnectDialog}
        allowedEdgeTypes={allowedEdgeTypes}
        confirmConnect={confirmConnect}
        setShowConnectDialog={setShowConnectDialog}
      />

      <ContextMenu>
        <ContextMenuTrigger asChild>
          <span ref={contextMenuTriggerRef} className="hidden" />
        </ContextMenuTrigger>
        {contextMenuNodeId && (
          <ContextMenuContent
            contextMenuNodeId={contextMenuNodeId}
            serverNodes={findAllNodes.data || []}
            aiGenerateSummary={aiGenerateSummary}
            deleteNode={deleteNode}
            moveNode={(nodeId, newParentId) =>
              patchNode({ id: nodeId, manual: true, data: { parent_id: newParentId } })
            }
            regenerateNode={(nodeId) =>
              regenerateNode({ id: nodeId, options: { regenerateGenerated: true, regenerateManual: true } })
            }
            saveToFile={saveToFile}
          />
        )}
      </ContextMenu>

      <EdgeContextMenu edgeData={edgeContextMenuData} triggerRef={edgeContextMenuTrigger} />
    </div>
  )
}

function excludeDuplicates<T extends {}>(objA: T, objB: any): Partial<T> {
  return Object.fromEntries(
    Object.entries(objA).filter(([key, value]) => objB[key] !== value && value !== undefined),
  ) as Partial<T>
}
