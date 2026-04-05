import React from 'react';
import { type Connection } from '@xyflow/react';
import { useLocale } from '@/lib/locale';

interface EdgeTypeSelectionDialogProps {
  showConnectDialog: Connection | null;
  allowedEdgeTypes: string[];
  confirmConnect: (edgeType: string) => void;
  setShowConnectDialog: (connection: Connection | null) => void;
}

export default function EdgeTypeSelectionDialog({
  showConnectDialog,
  allowedEdgeTypes,
  confirmConnect,
  setShowConnectDialog,
}: EdgeTypeSelectionDialogProps) {
  const { t } = useLocale()
  if (!showConnectDialog) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-background border border-border rounded-lg shadow-xl p-4 w-64">
        <h3 className="text-sm font-semibold mb-3">{t('planGraph.selectEdgeType')}</h3>
        <div className="flex flex-col gap-2">
          {allowedEdgeTypes.map(type => (
            <button
              key={type}
              onClick={() => void confirmConnect(type)}
              className="px-3 py-1.5 text-sm rounded border border-border hover:bg-muted text-left"
            >
              {t(`planGraph.edge.${type}`)}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowConnectDialog(null)}
          className="mt-3 w-full text-xs text-muted-foreground hover:text-foreground"
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}