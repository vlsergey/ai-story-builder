import React from 'react'
import LoreTree from './LoreTree'
import type { LoreNode } from '../types/models'

interface LoreSectionProps {
  onSelectLoreNode: (node: LoreNode) => void
  onOpenLoreNode?: (node: LoreNode) => void
}

export default function LoreSection({ onSelectLoreNode, onOpenLoreNode }: LoreSectionProps) {
  return (
    <div>
      <LoreTree onSelectLoreNode={onSelectLoreNode} onOpenLoreNode={onOpenLoreNode} />
    </div>
  )
}
