import React, { useEffect, useState } from 'react'

// Simple plan tree viewer. Props:
// - `onSelect` - callback for node selection
export default function PlanTree({ onSelect }) {
  const [tree, setTree] = useState([])

  useEffect(() => { fetchTree() }, [])

  function fetchTree() {
    fetch('/api/plan/nodes').then(r => r.json()).then(setTree).catch(() => setTree([]))
  }

  function renderNode(node) {
    return (
      <li key={node.id} className="pl-2">
        <div className="cursor-pointer hover:bg-secondary rounded px-1 py-1 text-sm"
             onClick={() => onSelect && onSelect(node)}>{node.title}</div>
        {node.children && node.children.length > 0 && (
          <ul className="ml-4 mt-1">{node.children.map(renderNode)}</ul>
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
