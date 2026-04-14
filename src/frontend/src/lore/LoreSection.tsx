import React from "react"
import LoreTree from "./LoreTree"
import type { LoreNodeRow } from "../../../shared/lore-node.js"

interface LoreSectionProps {
  onSelectLoreNode: (node: LoreNodeRow) => void
  onOpenLoreNode?: (node: LoreNodeRow) => void
  onOpenLoreWizard?: (node: LoreNodeRow) => void
}

export default function LoreSection({ onSelectLoreNode, onOpenLoreNode, onOpenLoreWizard }: LoreSectionProps) {
  return (
    <div className="h-full">
      <LoreTree
        onSelectLoreNode={onSelectLoreNode}
        onOpenLoreNode={onOpenLoreNode}
        onOpenLoreWizard={onOpenLoreWizard}
      />
    </div>
  )
}
