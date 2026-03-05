import React from 'react'
import PlanTree from './PlanTree'

interface PlanSectionProps {
  onOpenEditor?: (nodeId: number) => void
  onOpenChildrenEditor?: (nodeId: number) => void
}

export default function PlanSection({ onOpenEditor, onOpenChildrenEditor }: PlanSectionProps) {
  return (
    <div className="h-full">
      <PlanTree
        onOpenEditor={onOpenEditor}
        onOpenChildrenEditor={onOpenChildrenEditor}
      />
    </div>
  )
}
