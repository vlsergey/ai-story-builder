import React from 'react'
import FolderTree from './FolderTree'

export default function FolderSection({ onSelectLoreItem }) {
  console.log('FolderSection rendered')
  return (
    <div>
      <FolderTree onSelectLoreItem={onSelectLoreItem} />
    </div>
  )
}
