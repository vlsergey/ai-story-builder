import React from 'react'
import FolderTree from './FolderTree'
import type { LoreItem } from '../types/models'

interface FolderSectionProps {
  onSelectLoreItem: (loreItem: LoreItem) => void
}

export default function FolderSection({ onSelectLoreItem }: FolderSectionProps) {
  console.log('FolderSection rendered')
  return (
    <div>
      <FolderTree onSelectLoreItem={onSelectLoreItem} />
    </div>
  )
}
