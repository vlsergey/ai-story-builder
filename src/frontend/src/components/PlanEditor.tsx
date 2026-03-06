import React, { useMemo } from 'react'
import { useLocale } from '../lib/locale'
import { dispatchPlanNodeSaved, dispatchPlanTreeRefresh } from '../lib/plan-events'
import NodeEditor, { type NodeEditorAdapter } from './NodeEditor'

interface PlanEditorProps {
  nodeId: number
  panelApi?: { setTitle: (title: string) => void }
  onOpenChildrenEditor?: (nodeId: number) => void
}

export default function PlanEditor({ nodeId, panelApi, onOpenChildrenEditor }: PlanEditorProps) {
  const { t } = useLocale()

  const adapter = useMemo<NodeEditorAdapter>(() => ({
    apiBase: '/api/plan/nodes',
    primaryField: 'title',
    i18nPrefix: 'plan',
    generateEndpoint: '/api/ai/generate-plan',
    showMinWords: true,
    onSaved: ({ nodeId: id, primaryValue, wordCount, charCount, byteCount }) => {
      dispatchPlanNodeSaved({ id, title: primaryValue, wordCount, charCount, byteCount })
    },
    onAfterGenerate: dispatchPlanTreeRefresh,
    renderEditModeExtras: onOpenChildrenEditor
      ? (nId) => (
          <button
            onClick={() => onOpenChildrenEditor(nId)}
            className="px-3 py-1 text-sm rounded border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            {t('plan.split_into_children')}
          </button>
        )
      : undefined,
  }), [onOpenChildrenEditor, t])

  return <NodeEditor nodeId={nodeId} panelApi={panelApi} adapter={adapter} />
}
