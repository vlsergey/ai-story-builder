import React from 'react'
import { Diff } from 'diff'

// Simple side-by-side diff viewer for plain text
export default function DiffViewer({ oldText = '', newText = '' }) {
  // compute diff lines
  const diff = Diff.diffLines(oldText, newText)
  return (
    <div className="font-mono whitespace-pre-wrap bg-secondary p-2 rounded text-sm">
      {diff.map((part, i) => {
        let color = part.added ? 'text-green-600' : part.removed ? 'text-red-600' : 'text-foreground'
        return (
          <span key={i} className={color}>
            {part.value}
          </span>
        )
      })}
    </div>
  )
}
