import type { AiEngineAdapter, LoreGenerateRequest } from './ai-engine-adapter.js'
import { grokGenerate } from './grok-client.js'

export class GrokAdapter implements AiEngineAdapter {
  async generateLore(
    req: LoreGenerateRequest,
    onThinking: (status: string) => void,
    onDelta: (text: string) => void,
  ): Promise<void> {
    const apiKey = req.config.grok?.api_key?.trim()
    if (!apiKey) throw new Error('Grok api_key is required')

    const maxFiles = req.engineDef.maxFilesPerRequest ?? 10
    const attachableFileIds = req.engineFileIds.slice(0, maxFiles)
    const userContent: Array<{ type: 'input_text'; text: string } | { type: 'input_file'; file_id: string }> = [
      { type: 'input_text', text: req.prompt },
    ]
    if (req.includeExistingLore && req.engineDef.capabilities.fileAttachment && attachableFileIds.length > 0) {
      for (const fileId of attachableFileIds) {
        userContent.push({ type: 'input_file', file_id: fileId })
      }
    }

    const requestParams: Record<string, unknown> = {
      model: req.model || 'grok-3',
      instructions: req.systemPrompt,
      input: [{ role: 'user', content: userContent }],
    }
    if (req.webSearch && req.webSearch !== 'none') {
      requestParams.tools = [{ type: 'web_search' }]
    }

    onThinking('generating')
    await grokGenerate(apiKey, requestParams, onThinking, onDelta)
    onThinking('done')
  }
}
