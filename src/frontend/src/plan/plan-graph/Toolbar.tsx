import React from 'react';
import { type PlanNodeType } from '@shared/plan-graph';
import { useLocale } from '@/lib/locale';

interface ToolbarProps {
  creatableNodeTypes: PlanNodeType[];
  openAddDialog: (type: PlanNodeType) => void;
  autoLayout: boolean;
  toggleAutoLayout: () => void;
  applyLayout: () => void;
}

export default function Toolbar({
  creatableNodeTypes,
  openAddDialog,
  autoLayout,
  toggleAutoLayout,
  applyLayout,
}: ToolbarProps) {
  const { t } = useLocale()
  return (
    <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5 bg-background border border-border rounded shadow px-2 py-1.5 flex-wrap">
      {creatableNodeTypes.map((nodeType) => (
        <button
          key={nodeType}
          onClick={() => openAddDialog(nodeType)}
          title={t(`planGraph.add${nodeType.charAt(0).toUpperCase() + nodeType.slice(1)}Node`)}
          className="text-xs px-2 py-1 rounded border border-border hover:bg-muted transition-colors"
        >
          {t(`planGraph.add${nodeType.charAt(0).toUpperCase() + nodeType.slice(1)}Node`)}
        </button>
      ))}
      <div className="w-px h-4 bg-border mx-0.5" />
      <label className="flex items-center gap-1 text-xs cursor-pointer">
        <input
          type="checkbox"
          checked={autoLayout}
          onChange={toggleAutoLayout}
          className="w-3 h-3"
        />
        {t('planGraph.autoLayout')}
      </label>
      {!autoLayout && (
        <button
          onClick={applyLayout}
          className="text-xs px-2 py-1 rounded border border-border hover:bg-muted transition-colors"
        >
          {t('planGraph.applyLayout')}
        </button>
      )}
    </div>
  );
}