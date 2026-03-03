import React from 'react'
import LoreFolderTree from './LoreFolderTree'
import type { LoreNode } from '../types/models'

interface LoreFolderSectionProps {
  onSelectLoreNode: (node: LoreNode) => void
}

export default function LoreFolderSection({ onSelectLoreNode }: LoreFolderSectionProps) {
  return (
    <div>
      <LoreFolderTree onSelectLoreNode={onSelectLoreNode} />
    </div>
  )
}
