import React from 'react'
import PlanTree from './PlanTree'
import type { PlanNodeTree } from '../types/models'

interface PlanSectionProps {
  onSelectNode: (node: PlanNodeTree) => void
}

export default function PlanSection({ onSelectNode }: PlanSectionProps) {
  return (
    <div>
      <PlanTree onSelectNode={onSelectNode} />
    </div>
  )
}
