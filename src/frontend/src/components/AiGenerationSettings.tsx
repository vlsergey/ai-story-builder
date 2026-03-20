import React from 'react'
import { BUILTIN_ENGINES } from '../../../shared/ai-engines'
import type { AiGenerationSettings as AiGenerationSettingsDto } from '../../../shared/ai-generation-settings'
import EngineAiSettingsField from './EngineAiSettingsField'
import { trpc } from '@/ipcClient'
import { Input } from './ui/input'
import { AiEngineConfig } from '@shared/ai-engine-config'

function shortModelName(modelId: string): string {
  return modelId.replace(/^gpt:\/\/[^/]+\//, '')
}

interface AiGenerationSettingsProps {
  engineId: string | null
  value: AiGenerationSettingsDto
  onChange: (s: AiGenerationSettingsDto) => void
  disabled?: boolean
  className?: string
}

export default function AiGenerationSettings({
  engineId,
  value,
  onChange,
  disabled,
  className = 'flex items-center gap-3 px-2 py-1.5 border-b border-border shrink-0 flex-wrap',
}: AiGenerationSettingsProps) {
  const engineDef = BUILTIN_ENGINES.find(e => e.id === engineId)

  const allAiEnginesConfig = trpc.settings.allAiEnginesConfig.get.useQuery().data
  const aiEngineConfig: AiEngineConfig = engineId ? (allAiEnginesConfig || {})[engineId] || {} : {}
  const availableModels = aiEngineConfig.available_models || []

  const set = (patch: Partial<AiGenerationSettingsDto>) => onChange({ ...value, ...patch })

  const handleEngineFieldChange = (engine: string, fieldKey: string, value: any) => {
    set({ [fieldKey]: value })
  }

  return (
    <div className={className}>
      {availableModels.length > 0 && (
        <select
          value={value.model ?? ''}
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
      <label className="flex items-center gap-1.5 text-sm shrink-0">
        <span className="text-muted-foreground">Max tokens</span>
        <Input
          type="number"
          min={1}
          value={value.maxTokens ?? 2048}
          onChange={e => { const v = parseInt(e.target.value, 10); if (v > 0) set({ maxTokens: v }) }}
          disabled={disabled}
          className="w-28"
        />
      </label>
      <label className="flex items-center gap-1.5 text-sm shrink-0">
        <span className="text-muted-foreground">Max completion tokens</span>
        <Input
          type="number"
          min={0}
          value={value.maxCompletionTokens ?? 0}
          onChange={e => { const v = parseInt(e.target.value, 10) || 0; set({ maxCompletionTokens: v > 0 ? v : undefined }) }}
          disabled={disabled}
          className="w-28"
        />
      </label>
      {engineDef?.aiSettingsFields.map(field => {
        const fieldValue = value[field.key] ?? field.defaultValue
        return (
          <EngineAiSettingsField
            key={field.key}
            disabled={disabled}
            engine={engineDef}
            field={field}
            value={fieldValue}
            onChange={handleEngineFieldChange}
          />
        )
      })}
    </div>
  )
}
