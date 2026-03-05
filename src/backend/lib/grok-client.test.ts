import { describe, it, expect, vi, beforeEach } from 'vitest'

// Must mock before importing grok-client
const mockCreate = vi.fn()
vi.mock('openai', () => ({
  // Use a regular function (not arrow) so it can be used as a constructor with `new`
  default: vi.fn().mockImplementation(function () {
    return { responses: { create: mockCreate } }
  }),
}))
vi.mock('./yandex-client.js', () => ({
  makeLoggingFetch: () => undefined,
  isVerboseLogging: () => false,
}))

import { grokGenerate } from './grok-client.js'

function makeStream(events: Record<string, unknown>[]) {
  return (async function* () {
    for (const ev of events) yield ev
  })()
}

describe('grokGenerate — onThinking callbacks', () => {
  beforeEach(() => mockCreate.mockReset())

  it('calls onThinking("web_search_completed", query) when output_item.done fires with web_search_call', async () => {
    mockCreate.mockResolvedValue(makeStream([
      {
        type: 'response.output_item.done',
        item: {
          type: 'web_search_call',
          status: 'completed',
          action: { type: 'search', query: 'some search query', sources: [] },
        },
      },
    ]))

    const onThinking = vi.fn()
    await grokGenerate('fake-key', { model: 'grok-3' }, onThinking)

    expect(onThinking).toHaveBeenCalledWith('web_search_completed', 'some search query')
  })

  it('calls onThinking("web_search_completed") without detail when no query in output_item.done', async () => {
    mockCreate.mockResolvedValue(makeStream([
      {
        type: 'response.output_item.done',
        item: { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [] } },
      },
    ]))

    const onThinking = vi.fn()
    await grokGenerate('fake-key', { model: 'grok-3' }, onThinking)

    expect(onThinking).toHaveBeenCalledWith('web_search_completed', undefined)
  })

  it('ignores output_item.done for non-web_search_call items', async () => {
    mockCreate.mockResolvedValue(makeStream([
      {
        type: 'response.output_item.done',
        item: { type: 'message', content: [] },
      },
    ]))

    const onThinking = vi.fn()
    await grokGenerate('fake-key', { model: 'grok-3' }, onThinking)

    expect(onThinking).not.toHaveBeenCalled()
  })
})
