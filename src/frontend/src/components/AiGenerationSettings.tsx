import React from 'react'
import { BUILTIN_ENGINES } from '../../../shared/ai-engines.js'
import type { AiSettings } from '../../../shared/ai-settings.js'

function shortModelName(modelId: string): string {
  return modelId.replace(/^gpt:\/\/[^/]+\//, '')
}

interface AiGenerationSettingsProps {
  engineId: string | null
  availableModels: string[]
  settings: AiSettings
  onSettingsChange: (s: AiSettings) => void
  showMinWords?: boolean
  disabled?: boolean
  className?: string
}

export default function AiGenerationSettings({
  engineId,
  availableModels,
  settings,
  onSettingsChange,
  showMinWords,
  disabled,
  className = 'flex items-center gap-3 px-2 py-1.5 border-b border-border shrink-0 flex-wrap',
}: AiGenerationSettingsProps) {
  const engineDef = BUILTIN_ENGINES.find(e => e.id === engineId)
  const set = (patch: Partial<AiSettings>) => onSettingsChange({ ...settings, ...patch })

  return (
    <div className={className}>
      {engineDef?.webSearch === 'contextSize' && (
        <select
          value={settings.webSearch ?? 'none'}
          onChange={e => set({ webSearch: e.target.value })}
          disabled={disabled}
          className="text-sm border border-border rounded px-2 py-0.5 bg-background disabled:opacity-50"
          title="Web search"
        >
          <option value="none">No web search</option>
          <option value="low">Web: low</option>
          <option value="medium">Web: medium</option>
          <option value="high">Web: high</option>
        </select>
      )}
      {engineDef?.webSearch === 'boolean' && (
        <label className="flex items-center gap-1.5 text-sm select-none cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={(settings.webSearch ?? 'none') !== 'none'}
            onChange={e => set({ webSearch: e.target.checked ? 'on' : 'none' })}
            className="accent-primary"
            disabled={disabled}
          />
          Web search
        </label>
      )}
      {availableModels.length > 0 && (
        <select
          value={settings.model ?? ''}
          onChange={e => set({ model: e.target.value })}
          disabled={disabled}
          className="text-sm border border-border rounded px-2 py-0.5 bg-background max-w-[200px] disabled:opacity-50"
          title="Model"
        >
          {availableModels.map(m => (
            <option key={m} value={m}>{shortModelName(m)}</option>
          ))}
        </select>
      )}
      <label className="flex items-center gap-1.5 text-sm select-none cursor-pointer shrink-0">
        <input
          type="checkbox"
          checked={settings.includeExistingLore ?? true}
          onChange={e => set({ includeExistingLore: e.target.checked })}
          className="accent-primary"
          disabled={disabled}
        />
        Include existing lore
      </label>
      <label className="flex items-center gap-1.5 text-sm shrink-0">
        <span className="text-muted-foreground">Max tokens</span>
        <input
          type="number"
          min={1}
          value={settings.maxTokens ?? 2048}
          onChange={e => { const v = parseInt(e.target.value, 10); if (v > 0) set({ maxTokens: v }) }}
          disabled={disabled}
          className="w-28 text-sm border border-border rounded px-2 py-0.5 bg-background disabled:opacity-50"
        />
      </label>
      <label className="flex items-center gap-1.5 text-sm shrink-0">
        <span className="text-muted-foreground">Max completion tokens</span>
        <input
          type="number"
          min={0}
          value={settings.maxCompletionTokens ?? 0}
          onChange={e => { const v = parseInt(e.target.value, 10) || 0; set({ maxCompletionTokens: v > 0 ? v : undefined }) }}
          disabled={disabled}
          className="w-28 text-sm border border-border rounded px-2 py-0.5 bg-background disabled:opacity-50"
        />
      </label>
      {showMinWords && (
        <label className="flex items-center gap-1.5 text-sm shrink-0">
          <span className="text-muted-foreground">Min words</span>
          <input
            type="number"
            min={0}
            value={settings.minWords ?? 0}
            onChange={e => { const v = parseInt(e.target.value, 10) || 0; set({ minWords: v > 0 ? v : undefined }) }}
            disabled={disabled}
            className="w-28 text-sm border border-border rounded px-2 py-0.5 bg-background disabled:opacity-50"
          />
        </label>
      )}
    </div>
  )
}
