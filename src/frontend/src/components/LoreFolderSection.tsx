import React from 'react'
import LoreFolderTree from './LoreFolderTree'
import type { LoreItem } from '../types/models'

interface LoreFolderSectionProps {
  onSelectLoreItem: (loreItem: LoreItem) => void
}

export default function LoreFolderSection({ onSelectLoreItem }: LoreFolderSectionProps) {
  return (
    <div>
      <LoreFolderTree onSelectLoreItem={onSelectLoreItem} />
    </div>
  )
}
