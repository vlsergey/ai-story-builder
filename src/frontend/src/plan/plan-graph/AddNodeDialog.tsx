import React, { useEffect, useRef, useState } from 'react';
import { type PlanNodeType } from '@shared/plan-graph';
import { useLocale } from '@/lib/locale';
import { Button } from '@/ui-components/button';
import { Input } from '@/ui-components/input';

interface AddNodeDialogProps {
  addDialog: { type: PlanNodeType } | null;
  confirmAddNode: (title: string) => void;
  setAddDialog: (dialog: { type: PlanNodeType } | null) => void;
}

export default function AddNodeDialog({
  addDialog,
  confirmAddNode,
  setAddDialog,
}: AddNodeDialogProps) {
  const { t } = useLocale()
  const [title, setTitle] = useState('')
  const addTitleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (addDialog) {
      // focus the input on next paint
      setTimeout(() => addTitleInputRef.current?.focus(), 0)
    }
  }, [addDialog])

  if (!addDialog) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-background border border-border rounded-lg shadow-xl p-4 w-72">
        <h3 className="text-sm font-semibold mb-3">
          {t(`planGraph.add${addDialog.type.charAt(0).toUpperCase() + addDialog.type.slice(1)}Node`)}
        </h3>
        <Input
          ref={addTitleInputRef}
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') void confirmAddNode(title);
            if (e.key === 'Escape') { setAddDialog(null); setTitle(''); }
          }}
          placeholder={t('planGraph.nodeTitle')}
          className="w-full px-3 py-1.5 text-sm border border-border rounded bg-background focus:outline-none focus:ring-1 focus:ring-ring mb-3"
        />
        <div className="flex gap-2 justify-end">
          <Button
            variant="secondary"
            onClick={() => { setAddDialog(null); setTitle(''); }}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="default"
            onClick={() => { confirmAddNode(title); setTitle(''); }}
            disabled={!title.trim()}
          >
            {t('common.add')}
          </Button>
        </div>
      </div>
    </div>
  );
}