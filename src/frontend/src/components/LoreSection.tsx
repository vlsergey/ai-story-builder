import React from 'react'
import LoreTree from './LoreTree'
import type { LoreNode } from '../types/models'

interface LoreSectionProps {
  onSelectLoreNode: (node: LoreNode) => void
}

export default function LoreSection({ onSelectLoreNode }: LoreSectionProps) {
  return (
    <div>
      <LoreTree onSelectLoreNode={onSelectLoreNode} />
    </div>
  )
}
