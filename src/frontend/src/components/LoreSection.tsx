import React, { useEffect, useState } from 'react'
import LoreTree from './LoreTree'
import type { LoreNode, LoreStatMode } from '../types/models'

interface LoreSectionProps {
  onSelectLoreNode: (node: LoreNode) => void
  onOpenLoreNode?: (node: LoreNode) => void
  statMode?: LoreStatMode
}

export default function LoreSection({ onSelectLoreNode, onOpenLoreNode, statMode }: LoreSectionProps) {
  const [currentAiEngine, setCurrentAiEngine] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings/current_backend')
      .then(r => r.json())
      .then((data: { value?: string | null }) => { setCurrentAiEngine(data.value ?? null) })
      .catch(() => { setCurrentAiEngine(null) })
  }, [])

  return (
    <div>
      <LoreTree
        onSelectLoreNode={onSelectLoreNode}
        onOpenLoreNode={onOpenLoreNode}
        statMode={statMode}
        currentAiEngine={currentAiEngine}
      />
    </div>
  )
}
