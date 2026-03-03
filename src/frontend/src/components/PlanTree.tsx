import React, { useEffect, useState } from 'react'
import { ChevronRight, ChevronDown, Layers, FileText } from 'lucide-react'
import { PlanNodeTree } from '../types/models'

function collectAllIds(nodes: PlanNodeTree[]): Set<number> {
  const ids = new Set<number>()
  function walk(list: PlanNodeTree[]) {
    list.forEach(n => { ids.add(n.id); if (n.children?.length) walk(n.children) })
  }
  walk(nodes)
  return ids
}

// Simple plan tree viewer. Props:
// - `onSelectNode` - callback for node selection
export default function PlanTree({ onSelectNode }: { onSelectNode: (node: PlanNodeTree) => void }) {
  const [tree, setTree] = useState<PlanNodeTree[]>([])
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  useEffect(() => { fetchTree() }, [])

  function fetchTree() {
    fetch('/api/plan/nodes')
      .then(r => r.json())
      .then((data: PlanNodeTree[]) => {
        setTree(data)
        setExpanded(collectAllIds(data)) // expand all by default
      })
      .catch(() => setTree([]))
  }

  function toggleExpanded(id: number) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function renderNode(node: PlanNodeTree) {
    const hasChildren = (node.children?.length ?? 0) > 0
    const isExpanded = expanded.has(node.id)
    const Icon = hasChildren ? Layers : FileText

    return (
      <li key={node.id}>
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
            onClick={() => onSelectNode(node)}
          >
            <Icon size={14} className="shrink-0 text-muted-foreground" />
            {node.title}
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
      <h4 className="font-semibold mb-2">Plan</h4>
      <div className="max-h-96 overflow-auto">
        <ul>{Array.isArray(tree) ? tree.map(renderNode) : null}</ul>
      </div>
    </div>
  )
}
