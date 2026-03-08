import React from 'react'
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import AiGenerationSettings from '../components/AiGenerationSettings'

const baseSettings = { webSearch: 'none', includeExistingLore: true, maxTokens: 16000000, maxCompletionTokens: 16000000 }

describe('AiGenerationSettings number inputs', () => {
  it('maxTokens input is wide enough for 8-digit values', () => {
    const { getByLabelText } = render(
      <AiGenerationSettings
        engineId={null}
        availableModels={[]}
        settings={baseSettings}
        onSettingsChange={() => {}}
      />
    )
    const input = getByLabelText(/max tokens/i)
    // w-20 (80px) is too narrow for 8 digits; must use w-28 (112px) or wider
    expect(input.className).not.toContain('w-20')
  })

  it('maxCompletionTokens input is wide enough for 8-digit values', () => {
    const { getByLabelText } = render(
      <AiGenerationSettings
        engineId={null}
        availableModels={[]}
        settings={baseSettings}
        onSettingsChange={() => {}}
      />
    )
    const input = getByLabelText(/max completion tokens/i)
    expect(input.className).not.toContain('w-20')
  })

})
