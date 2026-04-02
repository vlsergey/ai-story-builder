import { useCallback, useMemo } from 'react'
import { useLocale } from '@/lib/locale'
import { trpc } from '@/ipcClient'
import { Button } from '@/ui-components/button'
import { Label } from '@/ui-components/label'
import { Switch } from '@/ui-components/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/ui-components/card'
import TypedPlanNodeEditorProps from './TypedPlanNodeEditorProps'
import { SplitSettings } from '@shared/node-settings'
import { Input } from '@/ui-components/input'

export default function SplitNodeEditor({
  value,
  save,
  nodeTypeSettings,
  onExternalUpdate,
  onNodeTypeSettingsChange,
}: TypedPlanNodeEditorProps<SplitSettings>) {
  const { t } = useLocale()

  const parts = useMemo<string[]>(() => {
    if (value.content) {
      try {
        const parsed = JSON.parse(value.content)
        if (Array.isArray(parsed)) {
          return parsed
        } else {
          return []
        }
      } catch {
        return []
      }
    } else {
      return []
    }
  }, [value.content])

  const regenerateMutation = trpc.plan.nodes.regenerate.useMutation()
  const handleRegenerate = useCallback(async () => {
    await save(value)
    const result = await regenerateMutation.mutateAsync(value.id)
    onExternalUpdate(result)
  }, [onExternalUpdate, regenerateMutation, save, value])

  return (
    <div className="space-y-6 p-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('splitNode.settings')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="separator" className="text-sm">
              {t('splitNode.separator')}
            </Label>
            <input
              id="separator"
              value={nodeTypeSettings.separator}
              onChange={(e) => onNodeTypeSettingsChange({ ...nodeTypeSettings, separator: e.target.value })}
              className="w-full border rounded px-2 py-1 text-sm"
              placeholder={'e.g., "\\n\\n" or "\\\\s*---\\\\s*"'}
            />
          </div>

          <div className="flex items-center justify-between py-2">
            <Label htmlFor="autoUpdate" className="text-sm mr-2">
              {t('splitNode.autoUpdate')}
            </Label>
            <Switch
              id="autoUpdate"
              checked={nodeTypeSettings.autoUpdate}
              onCheckedChange={(checked: boolean) => onNodeTypeSettingsChange({ ...nodeTypeSettings, autoUpdate: checked })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="dropFirst" className="text-sm">
              {t('splitNode.dropFirst')}
            </Label>
            <Input
              type="number"
              min="0"
              value={nodeTypeSettings.dropFirst}
              onChange={(e) => onNodeTypeSettingsChange({ ...nodeTypeSettings, dropFirst: parseInt(e.target.value) || 0 })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="dropLast" className="text-sm">
              {t('splitNode.dropLast')}
            </Label>
            <Input
              type="number"
              min="0"
              value={nodeTypeSettings.dropLast}
              onChange={(e) => onNodeTypeSettingsChange({ ...nodeTypeSettings, dropLast: parseInt(e.target.value) || 0 })}
            />
          </div>
          {!nodeTypeSettings.autoUpdate && (
            <Button onClick={handleRegenerate} className="w-full">
              {t('common.update')}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('splitNode.parts')} ({parts.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {parts.map((part, index) => (
              <div key={index} className="p-2 border rounded">
                <div className="text-sm text-muted-foreground whitespace-pre-wrap max-h-20 overflow-y-auto">
                  {part}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
