import React from 'react'
import PlanTree from './PlanTree'

export default function PlanSection({ onSelectNode }) {
  return (
    <div>
      <PlanTree onSelect={onSelectNode} />
    </div>
  )
}
