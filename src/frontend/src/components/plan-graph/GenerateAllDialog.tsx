import React from 'react'
import { useLocale } from '../../lib/locale'

interface GenerateAllDialogProps {
  onClose: () => void
}

export default function GenerateAllDialog({ onClose }: GenerateAllDialogProps) {
  const { t } = useLocale()

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border border-border rounded-lg shadow-xl w-[480px] max-h-[80vh] flex flex-col">
        <div className="p-4 border-b border-border">
          <h2 className="text-lg font-semibold">{t('planGraph.generateAll.title')}</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <p className="text-sm text-muted-foreground">
            This feature is not yet available in the current version.
          </p>
        </div>

        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded border border-border hover:bg-muted"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
